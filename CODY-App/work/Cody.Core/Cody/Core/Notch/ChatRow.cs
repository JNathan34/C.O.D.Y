using System;

namespace HeyClicky.Core.Notch;

public abstract record ChatRow
{
	public sealed record Separator(DateTimeOffset Date) : ChatRow
	{
		public override string Id => "separator-" + Date.ToUnixTimeMilliseconds();
	}

	public sealed record Message(ConversationMessage Value, bool IsLastOfRun, bool IsFirstOfRun) : ChatRow
	{
		public override string Id => Value.RowId;
	}

	public sealed record HandOff(ChatHandOff Entry) : ChatRow
	{
		public override string Id => "handoff-" + Entry.Id;
	}

	public sealed record Typing(string? StatusText) : ChatRow
	{
		public override string Id => "typing";
	}

	public sealed record SentStatus(string Text) : ChatRow
	{
		public override string Id => "sent-status";
	}

	public abstract string Id { get; }
}
