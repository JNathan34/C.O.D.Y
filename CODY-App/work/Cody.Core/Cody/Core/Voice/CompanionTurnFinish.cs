using System.Collections.Generic;

namespace HeyClicky.Core.Voice;

public sealed record CompanionTurnFinish(bool WordedTurn, IReadOnlyList<string> HeardLines, bool DrewMarks)
{
	public string SpokenText => string.Join(" ", HeardLines).Trim();
}
