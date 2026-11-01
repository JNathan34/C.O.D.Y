using System;
using System.Collections.Generic;
using System.Linq;

namespace HeyClicky.Core.Notch;

public static class ChatTranscript
{
	private abstract record TimelineItem
	{
		public sealed record Msg(ConversationMessage Value) : TimelineItem
		{
			public override DateTimeOffset Date => Value.CreatedAt;
		}

		public sealed record Hand(ChatHandOff Entry) : TimelineItem
		{
			public override DateTimeOffset Date => Entry.CreatedAt;
		}

		public abstract DateTimeOffset Date { get; }
	}

	public static readonly TimeSpan SeparatorGap = TimeSpan.FromHours(1);

	public static readonly TimeSpan TypingLifetime = TimeSpan.FromSeconds(90L);

	public const int RowPageSize = 40;

	public static ChatLiveReply? LiveReply(bool rendersInChat, bool inProgress, string rawText, string? customStatus, string liveReplyId, DateTimeOffset now)
	{
		if (!rendersInChat || !inProgress)
		{
			return null;
		}
		List<string> list = ConversationMessage.BubbleSegmentsFrom(rawText);
		if (!rawText.EndsWith("\n\n", StringComparison.Ordinal) && list.Count > 0)
		{
			list.RemoveAt(list.Count - 1);
		}
		if (list.Count == 0)
		{
			string text = customStatus?.Trim();
			return new ChatLiveReply.Thinking(string.IsNullOrEmpty(text) ? null : text);
		}
		return new ChatLiveReply.Streaming(new ConversationMessage
		{
			Id = liveReplyId,
			Role = "assistant",
			Content = string.Join(" ", list),
			Source = "text",
			CreatedAt = now,
			BubbleSegments = list
		});
	}

	private static List<TimelineItem> Timeline(IReadOnlyList<ConversationMessage> messages, IReadOnlyList<ChatHandOff> handOffs)
	{
		Dictionary<int, List<ChatHandOff>> insertionsAfterIndex = new Dictionary<int, List<ChatHandOff>>();
		List<ChatHandOff> list = new List<ChatHandOff>();
		List<ConversationMessage> list2 = messages.Where((ConversationMessage m) => !m.IsPending).ToList();
		foreach (ChatHandOff entry in handOffs)
		{
			int num = list2.FindIndex((ConversationMessage m) => m.CreatedAt >= entry.CreatedAt.AddSeconds(-1.0));
			if (num < 0)
			{
				list.Add(entry);
				continue;
			}
			ChatHandOffKind kind = entry.Kind;
			if (kind == ChatHandOffKind.Started || kind == ChatHandOffKind.Text)
			{
				int num2 = num;
				if (list2[num2].IsUser && num2 + 1 < list2.Count && !list2[num2 + 1].IsUser)
				{
					num2++;
				}
				for (; num2 + 1 < list2.Count && !list2[num2 + 1].IsUser && (list2[num2 + 1].CreatedAt - list2[num2].CreatedAt).TotalSeconds < 5.0; num2++)
				{
				}
				Insert(num2, entry);
			}
			else
			{
				Insert((num == 0) ? (-1) : (num - 1), entry);
			}
		}
		List<TimelineItem> list3 = new List<TimelineItem>();
		if (insertionsAfterIndex.TryGetValue(-1, out List<ChatHandOff> value))
		{
			list3.AddRange(value.Select((ChatHandOff e) => new TimelineItem.Hand(e)));
		}
		for (int num3 = 0; num3 < list2.Count; num3++)
		{
			list3.Add(new TimelineItem.Msg(list2[num3]));
			if (insertionsAfterIndex.TryGetValue(num3, out List<ChatHandOff> value2))
			{
				list3.AddRange(value2.Select((ChatHandOff e) => new TimelineItem.Hand(e)));
			}
		}
		List<TimelineItem> source = messages.Where((ConversationMessage m) => m.IsPending).Select((Func<ConversationMessage, TimelineItem>)((ConversationMessage m) => new TimelineItem.Msg(m))).Concat(list.Select((ChatHandOff e) => new TimelineItem.Hand(e)))
			.ToList();
		list3.AddRange(from p in source.Select((TimelineItem item, int order) => (item: item, order: order))
			orderby p.item.Date, p.order
			select p.item);
		return list3;
		void Insert(int at, ChatHandOff item)
		{
			if (!insertionsAfterIndex.TryGetValue(at, out List<ChatHandOff> value3))
			{
				value3 = (insertionsAfterIndex[at] = new List<ChatHandOff>());
			}
			value3.Add(item);
		}
	}

	public static List<ChatRow> Rows(IReadOnlyList<ConversationMessage> messages, IReadOnlyList<ChatHandOff> handOffs, ChatLiveReply? liveReply, DateTimeOffset? lastAnswerEndedAt, DateTimeOffset now)
	{
		List<ConversationMessage> list = messages.Where((ConversationMessage m) =>
		{
			if (m.BubbleText.Length <= 0 && m.ActionCaption == null)
			{
				IReadOnlyList<string> attachmentPaths = m.AttachmentPaths;
				if (attachmentPaths != null)
				{
					return attachmentPaths.Count > 0;
				}
				return false;
			}
			return true;
		}).ToList();
		if (liveReply is ChatLiveReply.Streaming streaming)
		{
			list.Add(streaming.Message);
		}
		List<TimelineItem> list2 = Timeline(list, handOffs);
		List<ChatRow> list3 = new List<ChatRow>();
		DateTimeOffset? dateTimeOffset = null;
		for (int num = 0; num < list2.Count; num++)
		{
			TimelineItem timelineItem = list2[num];
			int num2;
			if (dateTimeOffset.HasValue)
			{
				DateTimeOffset valueOrDefault = dateTimeOffset.GetValueOrDefault();
				num2 = ((timelineItem.Date - valueOrDefault > SeparatorGap) ? 1 : 0);
			}
			else
			{
				num2 = 1;
			}
			bool flag = (byte)num2 != 0;
			if (flag)
			{
				list3.Add(new ChatRow.Separator(timelineItem.Date));
			}
			DateTimeOffset value;
			if (dateTimeOffset.HasValue)
			{
				DateTimeOffset valueOrDefault2 = dateTimeOffset.GetValueOrDefault();
				if (valueOrDefault2 > timelineItem.Date)
				{
					value = valueOrDefault2;
					goto IL_00dd;
				}
			}
			value = timelineItem.Date;
			goto IL_00dd;
			IL_00dd:
			dateTimeOffset = value;
			if (!(timelineItem is TimelineItem.Hand hand))
			{
				if (timelineItem is TimelineItem.Msg msg)
				{
					ConversationMessage value2 = msg.Value;
					ConversationMessage conversationMessage = ((num + 1 < list2.Count && list2[num + 1] is TimelineItem.Msg msg2) ? msg2.Value : null);
					ConversationMessage conversationMessage2 = ((num > 0 && list2[num - 1] is TimelineItem.Msg msg3) ? msg3.Value : null);
					bool flag2 = (object)conversationMessage == null || conversationMessage.CreatedAt - value2.CreatedAt > SeparatorGap;
					bool isLastOfRun = ((object)conversationMessage == null || conversationMessage.IsUser != value2.IsUser) | flag2;
					bool isFirstOfRun = ((object)conversationMessage2 == null || conversationMessage2.IsUser != value2.IsUser) | flag;
					list3.Add(new ChatRow.Message(value2, isLastOfRun, isFirstOfRun));
				}
			}
			else
			{
				list3.Add(new ChatRow.HandOff(hand.Entry));
			}
		}
		if (liveReply is ChatLiveReply.Thinking thinking)
		{
			list3.Add(new ChatRow.Typing(thinking.Status));
		}
		else if (liveReply is ChatLiveReply.Streaming)
		{
			list3.Add(new ChatRow.Typing(null));
		}
		else if ((object)liveReply == null)
		{
			ConversationMessage conversationMessage3 = list.LastOrDefault();
			if ((object)conversationMessage3 != null && conversationMessage3.IsPending && conversationMessage3.IsUser && now - conversationMessage3.CreatedAt < TypingLifetime)
			{
				if (lastAnswerEndedAt.HasValue)
				{
					DateTimeOffset valueOrDefault3 = lastAnswerEndedAt.GetValueOrDefault();
					if (!(conversationMessage3.CreatedAt > valueOrDefault3))
					{
						goto IL_029b;
					}
				}
				list3.Add(new ChatRow.Typing(null));
			}
		}
		goto IL_029b;
		IL_029b:
		InsertSentStatus(list3, now);
		return list3;
	}

	private static void InsertSentStatus(List<ChatRow> rows, DateTimeOffset now)
	{
		int num = rows.FindLastIndex((ChatRow r) =>
		{
			if (r is ChatRow.Message message2)
			{
				ConversationMessage value = message2.Value;
				if ((object)value != null)
				{
					return value.IsUser;
				}
			}
			return false;
		});
		if (num < 0 || !(rows[num] is ChatRow.Message message) || now - message.Value.CreatedAt >= TimeSpan.FromDays(1))
		{
			return;
		}
		bool flag = rows.Skip(num + 1).Any((ChatRow r) =>
		{
			if (r is ChatRow.Message message2)
			{
				return !message2.Value.IsUser;
			}
			return (r is ChatRow.Typing || r is ChatRow.HandOff) ? true : false;
		});
		rows.Insert(num + 1, new ChatRow.SentStatus(flag ? "Read" : "Delivered"));
	}
}
