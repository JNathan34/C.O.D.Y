using System;

namespace HeyClicky.Agents.Jobs;

public sealed record ClickyLiveLine(ClickyLiveLine.LineKind Kind, ClickyInkWorkStep.StepKind? StepKind, string Text, DateTimeOffset At)
{
	public enum LineKind
	{
		Thinking,
		Step
	}

	public DateTimeOffset ShownAt { get; init; } = DateTimeOffset.MinValue;

	public static ClickyLiveLine FromStep(ClickyInkWorkStep step)
	{
		string text = step.Object?.Replace("“", "").Replace("”", "").Replace("…", "")
			.Trim();
		if (string.IsNullOrEmpty(text))
		{
			text = null;
		}
		string text2 = step.Kind switch
		{
			ClickyInkWorkStep.StepKind.Search => text ?? "the web", 
			ClickyInkWorkStep.StepKind.Read => text ?? "a page", 
			ClickyInkWorkStep.StepKind.Look => "looking through the page", 
			ClickyInkWorkStep.StepKind.Math => "doing the math", 
			ClickyInkWorkStep.StepKind.Note => "writing the note", 
			ClickyInkWorkStep.StepKind.File => text ?? "a file", 
			ClickyInkWorkStep.StepKind.Apps => text ?? "your apps", 
			_ => "using your PC", 
		};
		return new ClickyLiveLine(LineKind.Step, step.Kind, text2, step.At);
	}

	public bool Equals(ClickyLiveLine? other)
	{
		if ((object)other != null && Kind == other.Kind && StepKind == other.StepKind && Text == other.Text)
		{
			return ShownAt == other.ShownAt;
		}
		return false;
	}

	public override int GetHashCode()
	{
		return HashCode.Combine(Kind, StepKind, Text, ShownAt);
	}
}
