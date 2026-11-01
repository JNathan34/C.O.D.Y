using System;
using System.Collections.Generic;
using System.Linq;

namespace HeyClicky.Core.Ink;

public sealed record ClickyInkActionFeedback
{
	public ClickyInkSentAction? Pending { get; init; }

	public IReadOnlyDictionary<string, ClickyInkSentAction> Answered { get; init; } = new Dictionary<string, ClickyInkSentAction>();

	public bool IsLocked => (object)Pending != null;

	public const double SteerPickupSeconds = 5.0;

	public const double PendingGivesUpSeconds = 900.0;

	public static ClickyInkActionFeedback Make(IReadOnlyList<ClickyInkSentAction> sent, DateTimeOffset? lastVersionAt, bool isRunning, DateTimeOffset? finishedAt, IReadOnlyList<DateTimeOffset>? editStartedAt = null, DateTimeOffset? now = null)
	{
		IReadOnlyList<DateTimeOffset> editStartedAt2 = editStartedAt ?? Array.Empty<DateTimeOffset>();
		DateTimeOffset dateTimeOffset = now ?? DateTimeOffset.Now;
		Dictionary<string, ClickyInkSentAction> dictionary = new Dictionary<string, ClickyInkSentAction>();
		List<ClickyInkSentAction> list = sent.OrderBy((ClickyInkSentAction a) => a.SentAt).ToList();
		foreach (ClickyInkSentAction item in list)
		{
			if (item.Kind != ClickyInkNoteAction.ActionKind.Ask && IsStillCurrent(item, editStartedAt2))
			{
				dictionary[item.ObjectKey] = item;
			}
		}
		ClickyInkSentAction pending = null;
		if (list.Count > 0)
		{
			ClickyInkSentAction clickyInkSentAction = list[list.Count - 1];
			bool flag = (dateTimeOffset - clickyInkSentAction.SentAt).TotalSeconds > 900.0;
			double num = (clickyInkSentAction.WasSentWhileRunning ? 5.0 : 0.0);
			int num2;
			if (lastVersionAt.HasValue)
			{
				DateTimeOffset valueOrDefault = lastVersionAt.GetValueOrDefault();
				num2 = (((valueOrDefault - clickyInkSentAction.SentAt).TotalSeconds > num) ? 1 : 0);
			}
			else
			{
				num2 = 0;
			}
			bool flag2 = (byte)num2 != 0;
			int num3;
			if (!isRunning && finishedAt.HasValue)
			{
				DateTimeOffset valueOrDefault2 = finishedAt.GetValueOrDefault();
				num3 = ((valueOrDefault2 > clickyInkSentAction.SentAt) ? 1 : 0);
			}
			else
			{
				num3 = 0;
			}
			bool flag3 = (byte)num3 != 0;
			if (!flag && !flag2 && !flag3)
			{
				pending = clickyInkSentAction;
			}
		}
		return new ClickyInkActionFeedback
		{
			Pending = pending,
			Answered = dictionary
		};
	}

	public static bool IsStillCurrent(ClickyInkSentAction action, IReadOnlyList<DateTimeOffset> editStartedAt)
	{
		return Enumerable.Count(editStartedAt, (DateTimeOffset d) => d > action.SentAt) <= 1;
	}

	public ClickyInkSentAction? AnswerFor(ClickyInkDocument.Block block)
	{
		if (!Answered.TryGetValue(ClickyInkObjectKey.Of(block), out ClickyInkSentAction value))
		{
			return null;
		}
		return value;
	}

	public bool IsPending(ClickyInkDocument.Block block)
	{
		return Pending?.ObjectKey == ClickyInkObjectKey.Of(block);
	}

	public bool Equals(ClickyInkActionFeedback? other)
	{
		if ((object)other != null && object.Equals(Pending, other.Pending) && Answered.Count == other.Answered.Count)
		{
			return Answered.All((KeyValuePair<string, ClickyInkSentAction> kv) => other.Answered.TryGetValue(kv.Key, out ClickyInkSentAction value) && value.Equals(kv.Value));
		}
		return false;
	}

	public override int GetHashCode()
	{
		return HashCode.Combine(Pending, Answered.Count);
	}
}
