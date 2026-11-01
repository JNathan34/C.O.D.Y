using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using HeyClicky.Core.Worker;

namespace HeyClicky.Core.Notch;

public sealed class ConversationHistory
{
	public sealed record Page(IReadOnlyList<ConversationMessage> Messages, bool HasMore);

	private const int PageSize = 40;

	private const int CachedMessageLimit = 200;

	private static readonly TimeSpan PendingMessageLifetime = TimeSpan.FromMinutes(10L);

	private readonly object gate = new object();

	private readonly Func<string?> accountId;

	private readonly Func<long?, CancellationToken, Task<Page?>> fetchPage;

	private readonly Func<DateTimeOffset> clock;

	private readonly string cacheFolder;

	private List<ConversationMessage> messages = new List<ConversationMessage>();

	private string? account;

	private DateTimeOffset? lastRefreshStartedAt;

	private bool refreshRunning;

	private bool earlierRunning;

	private string? liveReplyId;

	public IReadOnlyList<ConversationMessage> Messages
	{
		get
		{
			lock (gate)
			{
				return messages.ToList();
			}
		}
	}

	public bool HasEarlierMessages { get; private set; }

	public bool IsLoadingNewest { get; private set; }

	public bool IsLoadingEarlier { get; private set; }

	public bool HasLoadFailed { get; private set; }

	public DateTimeOffset? LastAnswerEndedAt { get; private set; }

	public bool IsAwaitingAnswerToSentMessage
	{
		get
		{
			lock (gate)
			{
				ConversationMessage conversationMessage = messages.LastOrDefault((ConversationMessage m) => m.IsUser && m.IsPending);
				if ((object)conversationMessage == null || clock() - conversationMessage.CreatedAt >= TimeSpan.FromSeconds(90L))
				{
					return false;
				}
				DateTimeOffset? lastAnswerEndedAt = LastAnswerEndedAt;
				int result;
				if (lastAnswerEndedAt.HasValue)
				{
					DateTimeOffset valueOrDefault = lastAnswerEndedAt.GetValueOrDefault();
					result = ((conversationMessage.CreatedAt > valueOrDefault) ? 1 : 0);
				}
				else
				{
					result = 1;
				}
				return (byte)result != 0;
			}
		}
	}

	private string? CachePath
	{
		get
		{
			if (string.IsNullOrEmpty(account))
			{
				return null;
			}
			string text = new string(account.Where((char c) => char.IsLetterOrDigit(c) || c == '-').ToArray());
			if (text.Length != 0)
			{
				return Path.Combine(cacheFolder, text + ".json");
			}
			return null;
		}
	}

	public event Action? Changed;

	public ConversationHistory(Func<string?> accountId, Func<long?, CancellationToken, Task<Page?>> fetchPage, string? cacheFolder = null, Func<DateTimeOffset>? clock = null)
	{
		this.accountId = accountId;
		this.fetchPage = fetchPage;
		this.clock = clock ?? ((Func<DateTimeOffset>)(() => DateTimeOffset.UtcNow));
		this.cacheFolder = cacheFolder ?? AppPaths.Combine("HeyClickyHistory");
	}

	public static Func<long?, CancellationToken, Task<Page?>> WorkerFetcher(WorkerClient worker)
	{
		return async (long? beforeId, CancellationToken ct) =>
		{
			try
			{
				string text = $"/me/companion-history?limit={40}";
				string text2;
				if (beforeId.HasValue)
				{
					long valueOrDefault = beforeId.GetValueOrDefault();
					text2 = $"&before_id={valueOrDefault}";
				}
				else
				{
					text2 = "";
				}
				string path = text + text2;
				JsonObject jsonObject = await worker.GetJsonObjectAsync(path, ct).ConfigureAwait(continueOnCapturedContext: false);
				return (jsonObject == null) ? null : ParsePage(jsonObject);
			}
			catch (Exception ex)
			{
				Log.Warn("ChatHistory", "companion-history failed: " + ex.Message);
				return (Page?)null;
			}
		};
	}

	public static Page? ParsePage(JsonObject json)
	{
		if (!(json["messages"] is JsonArray jsonArray))
		{
			return null;
		}
		List<ConversationMessage> list = new List<ConversationMessage>();
		foreach (JsonNode item in jsonArray)
		{
			if (!(item is JsonObject jsonObject))
			{
				continue;
			}
			long? num = jsonObject["id"]?.GetValue<long>();
			if (num.HasValue)
			{
				long valueOrDefault = num.GetValueOrDefault();
				string text = jsonObject["role"]?.GetValue<string>();
				bool flag = ((text == "user" || text == "assistant") ? true : false);
				if (flag && DateTimeOffset.TryParse(jsonObject["created_at"]?.GetValue<string>(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var result))
				{
					list.Add(new ConversationMessage
					{
						Id = "server-" + valueOrDefault,
						ServerId = valueOrDefault,
						Role = text,
						Content = (jsonObject["content"]?.GetValue<string>() ?? ""),
						Source = (jsonObject["source"]?.GetValue<string>() ?? "voice"),
						CreatedAt = result
					});
				}
			}
		}
		return new Page(list, json["has_more"]?.GetValue<bool>() ?? false);
	}

	public void Refresh()
	{
		string requested;
		lock (gate)
		{
			AdoptAccount(accountId());
			if (account == null || refreshRunning)
			{
				return;
			}
			DateTimeOffset? dateTimeOffset = lastRefreshStartedAt;
			if (dateTimeOffset.HasValue)
			{
				DateTimeOffset valueOrDefault = dateTimeOffset.GetValueOrDefault();
				if (clock() - valueOrDefault < TimeSpan.FromSeconds(2L))
				{
					return;
				}
			}
			lastRefreshStartedAt = clock();
			refreshRunning = true;
			IsLoadingNewest = true;
			requested = account;
		}
		RaiseChanged();
		Task.Run(async () =>
		{
			Page page = await fetchPage(null, CancellationToken.None).ConfigureAwait(continueOnCapturedContext: false);
			lock (gate)
			{
				refreshRunning = false;
				IsLoadingNewest = false;
				if (!(account != requested))
				{
					if ((object)page != null)
					{
						HasLoadFailed = false;
						long num = (from m in messages
							where m.ServerId.HasValue
							select m.ServerId.Value).DefaultIfEmpty(long.MinValue).Max();
						long? oldestPage = ((page.Messages.Count > 0) ? page.Messages.Min((ConversationMessage m) => m.ServerId) : ((long?)null));
						if (page.HasMore && num != long.MinValue && oldestPage.HasValue)
						{
							long valueOrDefault2 = oldestPage.GetValueOrDefault();
							if (valueOrDefault2 > num)
							{
								messages = messages.Where((ConversationMessage m) => m.IsPending).ToList();
								HasEarlierMessages = true;
								goto IL_027c;
							}
						}
						if (!messages.Any((ConversationMessage m) => (m.ServerId ?? long.MaxValue) < (oldestPage ?? long.MinValue)))
						{
							HasEarlierMessages = page.HasMore;
						}
						goto IL_027c;
					}
					HasLoadFailed = messages.Count == 0;
				}
				goto end_IL_00a0;
				IL_027c:
				Merge(page.Messages);
				end_IL_00a0:;
			}
			RaiseChanged();
		});
	}

	public void LoadEarlier()
	{
		long oldest;
		string requested;
		lock (gate)
		{
			if (!HasEarlierMessages || earlierRunning || account == null)
			{
				return;
			}
			long? num = messages.FirstOrDefault((ConversationMessage m) => m.ServerId.HasValue)?.ServerId;
			if (!num.HasValue)
			{
				return;
			}
			long valueOrDefault = num.GetValueOrDefault();
			oldest = valueOrDefault;
			earlierRunning = true;
			IsLoadingEarlier = true;
			requested = account;
		}
		RaiseChanged();
		Task.Run(async () =>
		{
			Page page = await fetchPage(oldest, CancellationToken.None).ConfigureAwait(continueOnCapturedContext: false);
			lock (gate)
			{
				earlierRunning = false;
				IsLoadingEarlier = false;
				if (account == requested && (object)page != null)
				{
					HasEarlierMessages = page.HasMore;
					Merge(page.Messages);
				}
			}
			RaiseChanged();
		});
	}

	public void NoteUserSentText(string text, IReadOnlyList<string>? attachmentPaths = null)
	{
		IReadOnlyList<string> readOnlyList = attachmentPaths ?? Array.Empty<string>();
		string text2 = text;
		if (text2.Length == 0 && readOnlyList.Count > 0)
		{
			text2 = "\ud83d\udcce " + string.Join(", ", readOnlyList.Select(Path.GetFileName));
		}
		if (text2.Length != 0)
		{
			lock (gate)
			{
				AdoptAccount(accountId());
				messages.Add(new ConversationMessage
				{
					Id = "local-" + Guid.NewGuid(),
					Role = "user",
					Content = text2,
					Source = "text",
					CreatedAt = clock(),
					AttachmentPaths = ((readOnlyList.Count == 0) ? null : readOnlyList.ToList())
				});
			}
			RaiseChanged();
		}
	}

	public void NoteAssistantReplyFinished(string text)
	{
		lock (gate)
		{
			AdoptAccount(accountId());
			LastAnswerEndedAt = clock();
			string id = LiveReplyMessageIdCore();
			liveReplyId = null;
			List<string> list = ConversationMessage.BubbleSegmentsFrom(text);
			if (list.Count > 0)
			{
				messages.Add(new ConversationMessage
				{
					Id = id,
					Role = "assistant",
					Content = string.Join(" ", list),
					Source = "text",
					CreatedAt = clock(),
					BubbleSegments = ((list.Count > 1) ? list : null)
				});
			}
		}
		RaiseChanged();
	}

	public void NoteAssistantReport(string text)
	{
		List<string> list = ConversationMessage.BubbleSegmentsFrom(text);
		if (list.Count != 0)
		{
			lock (gate)
			{
				AdoptAccount(accountId());
				messages.Add(new ConversationMessage
				{
					Id = "local-" + Guid.NewGuid(),
					Role = "assistant",
					Content = string.Join(" ", list),
					Source = "voice",
					CreatedAt = clock(),
					BubbleSegments = ((list.Count > 1) ? list : null)
				});
			}
			RaiseChanged();
		}
	}

	public void NoteAnswerStopped()
	{
		lock (gate)
		{
			LastAnswerEndedAt = clock();
			liveReplyId = null;
		}
		RaiseChanged();
	}

	public string LiveReplyMessageId()
	{
		lock (gate)
		{
			return LiveReplyMessageIdCore();
		}
	}

	private string LiveReplyMessageIdCore()
	{
		return liveReplyId ?? (liveReplyId = "local-" + Guid.NewGuid());
	}

	public void RefreshSoon()
	{
		double[] array = new double[2] { 2.5, 7.0 };
		for (int i = 0; i < array.Length; i++)
		{
			Task.Delay(TimeSpan.FromSeconds(array[i])).ContinueWith((Task _) =>
			{
				Refresh();
			}, TaskScheduler.Default);
		}
	}

	public void Reset()
	{
		lock (gate)
		{
			ResetCore();
		}
		RaiseChanged();
	}

	private void ResetCore()
	{
		account = null;
		lastRefreshStartedAt = null;
		messages = new List<ConversationMessage>();
		HasEarlierMessages = false;
		IsLoadingNewest = false;
		IsLoadingEarlier = false;
		HasLoadFailed = false;
		LastAnswerEndedAt = null;
		liveReplyId = null;
	}

	private void Merge(IReadOnlyList<ConversationMessage> incoming)
	{
		Dictionary<long, ConversationMessage> dictionary = new Dictionary<long, ConversationMessage>();
		foreach (ConversationMessage message in messages)
		{
			long? serverId = message.ServerId;
			if (serverId.HasValue)
			{
				long valueOrDefault = serverId.GetValueOrDefault();
				dictionary[valueOrDefault] = message;
			}
		}
		foreach (ConversationMessage item in incoming)
		{
			long? serverId = item.ServerId;
			if (serverId.HasValue)
			{
				long valueOrDefault2 = serverId.GetValueOrDefault();
				ConversationMessage conversationMessage = item;
				dictionary.TryGetValue(valueOrDefault2, out var value);
				conversationMessage = conversationMessage with
				{
					AttachmentPaths = (conversationMessage.AttachmentPaths ?? value?.AttachmentPaths),
					BubbleSegments = (conversationMessage.BubbleSegments ?? value?.BubbleSegments),
					ReplacedLocalId = (conversationMessage.ReplacedLocalId ?? value?.ReplacedLocalId)
				};
				dictionary[valueOrDefault2] = conversationMessage;
			}
		}
		List<ConversationMessage> saved = (from m in dictionary.Values
			orderby m.CreatedAt, m.ServerId.GetValueOrDefault()
			select m).ToList();
		foreach (ConversationMessage pending in messages.Where((ConversationMessage m) => m.IsPending))
		{
			int num;
			if (pending.IsUser)
			{
				string typedText = pending.Content.Trim();
				bool isFilesOnly = typedText.StartsWith("\ud83d\udcce ", StringComparison.Ordinal);
				num = saved.FindIndex((ConversationMessage s) => s.IsUser && s.ReplacedLocalId == null && s.CreatedAt >= pending.CreatedAt.AddSeconds(isFilesOnly ? (-20) : (-120)) && (isFilesOnly || s.TypedWords.Trim() == typedText));
			}
			else
			{
				string opening = MatchingOpening(pending.BubbleText);
				num = saved.FindIndex((ConversationMessage s) =>
				{
					if (s.IsUser || s.ReplacedLocalId != null)
					{
						return false;
					}
					double totalSeconds = (s.CreatedAt - pending.CreatedAt).TotalSeconds;
					return totalSeconds >= -20.0 || (totalSeconds >= -180.0 && opening.Length > 0 && MatchingOpening(s.BubbleText) == opening);
				});
			}
			if (num >= 0)
			{
				saved[num] = saved[num] with
				{
					ReplacedLocalId = pending.Id,
					AttachmentPaths = (saved[num].AttachmentPaths ?? pending.AttachmentPaths),
					BubbleSegments = (saved[num].BubbleSegments ?? pending.BubbleSegments)
				};
			}
		}
		DateTimeOffset now = clock();
		List<ConversationMessage> list = messages.Where((ConversationMessage conversationMessage2) =>
		{
			if (!conversationMessage2.IsPending || now - conversationMessage2.CreatedAt >= PendingMessageLifetime)
			{
				return false;
			}
			string typedText2 = conversationMessage2.Content.Trim();
			if (!conversationMessage2.IsUser)
			{
				string opening2 = MatchingOpening(conversationMessage2.BubbleText);
				return !saved.Any((ConversationMessage s) =>
				{
					if (s.IsUser)
					{
						return false;
					}
					double totalSeconds = (s.CreatedAt - conversationMessage2.CreatedAt).TotalSeconds;
					if (totalSeconds >= -20.0)
					{
						return true;
					}
					return totalSeconds >= -180.0 && opening2.Length > 0 && MatchingOpening(s.BubbleText) == opening2;
				});
			}
			return typedText2.StartsWith("\ud83d\udcce ", StringComparison.Ordinal) ? (!saved.Any((ConversationMessage s) => s.IsUser && s.CreatedAt >= conversationMessage2.CreatedAt.AddSeconds(-20.0))) : (!saved.Any((ConversationMessage s) => s.IsUser && s.CreatedAt >= conversationMessage2.CreatedAt.AddSeconds(-120.0) && s.TypedWords.Trim() == typedText2));
		}).ToList();
		List<ConversationMessage> list2 = saved;
		List<ConversationMessage> list3 = list;
		int num2 = list2.Count + list3.Count;
		List<ConversationMessage> list4 = new List<ConversationMessage>(num2);
		CollectionsMarshal.SetCount(list4, num2);
		Span<ConversationMessage> span = CollectionsMarshal.AsSpan(list4);
		int num3 = 0;
		Span<ConversationMessage> span2 = CollectionsMarshal.AsSpan(list2);
		span2.CopyTo(span.Slice(num3, span2.Length));
		num3 += span2.Length;
		Span<ConversationMessage> span3 = CollectionsMarshal.AsSpan(list3);
		span3.CopyTo(span.Slice(num3, span3.Length));
		num3 += span3.Length;
		messages = list4;
		SaveToDisk();
	}

	private static string MatchingOpening(string text)
	{
		List<string> list = new List<string>();
		StringBuilder stringBuilder = new StringBuilder();
		string text2 = text.ToLowerInvariant();
		foreach (char c in text2)
		{
			if (char.IsWhiteSpace(c) || char.IsPunctuation(c))
			{
				if (stringBuilder.Length > 0)
				{
					list.Add(stringBuilder.ToString());
					stringBuilder.Clear();
				}
			}
			else
			{
				stringBuilder.Append(c);
			}
		}
		if (stringBuilder.Length > 0)
		{
			list.Add(stringBuilder.ToString());
		}
		string text3 = string.Join(" ", list);
		if (text3.Length <= 32)
		{
			return text3;
		}
		return text3.Substring(0, 32);
	}

	private void AdoptAccount(string? next)
	{
		if (next == account)
		{
			return;
		}
		ResetCore();
		account = next;
		string cachePath = CachePath;
		if (cachePath == null || !File.Exists(cachePath))
		{
			return;
		}
		try
		{
			CachedConversation cachedConversation = JsonSerializer.Deserialize(File.ReadAllBytes(cachePath), NotchChatJsonContext.Default.CachedConversation);
			if ((object)cachedConversation != null)
			{
				messages = cachedConversation.Messages.ToList();
				HasEarlierMessages = cachedConversation.HasEarlierMessages;
			}
		}
		catch (Exception ex)
		{
			Log.Warn("ChatHistory", "cache unreadable: " + ex.Message);
		}
	}

	private void SaveToDisk()
	{
		string path = CachePath;
		if (path == null)
		{
			return;
		}
		List<ConversationMessage> list = messages.Where((ConversationMessage m) => !m.IsPending).ToList();
		List<ConversationMessage> list2 = list.Skip(Math.Max(0, list.Count - 200)).ToList();
		CachedConversation value = new CachedConversation(list2, HasEarlierMessages || list2.Count < list.Count);
		byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(value, NotchChatJsonContext.Default.CachedConversation);
		Task.Run(() =>
		{
			try
			{
				Directory.CreateDirectory(Path.GetDirectoryName(path));
				string text = path + ".tmp";
				File.WriteAllBytes(text, bytes);
				File.Move(text, path, overwrite: true);
			}
			catch (Exception ex)
			{
				Log.Warn("ChatHistory", "cache write failed: " + ex.Message);
			}
		});
	}

	private void RaiseChanged()
	{
		try
		{
			Changed?.Invoke();
		}
		catch (Exception ex)
		{
			Log.Warn("ChatHistory", "Changed handler threw: " + ex.Message);
		}
	}
}
