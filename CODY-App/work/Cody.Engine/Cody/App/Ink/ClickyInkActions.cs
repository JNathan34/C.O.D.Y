using System;
using System.Collections.Generic;
using System.Text.Json.Nodes;
using HeyClicky.Core.Ink;

namespace HeyClicky.App.Ink;

public sealed class ClickyInkActions
{
	public Action<string> Send { get; set; } = (string _) =>
	{
	};

	public Action<string> Open { get; set; } = (string _) =>
	{
	};

	public Func<string, string> ResolvePath { get; set; } = ClickyInkPaths.ExpandingTilde;

	public Action<string, string> Toggle { get; set; } = (string _, string _) =>
	{
	};

	public Action<ClickyInkNoteAction> Perform { get; set; } = (ClickyInkNoteAction _) =>
	{
	};

	public ClickyInkActionFeedback Feedback { get; set; } = new ClickyInkActionFeedback();

	public IReadOnlyList<ClickyInkRoutineControl> Routines { get; set; } = Array.Empty<ClickyInkRoutineControl>();

	public Action<string, bool> SetRoutinePaused { get; set; } = (string _, bool _) =>
	{
	};

	public Action<string, int> SetRoutineInterval { get; set; } = (string _, int _) =>
	{
	};

	public Func<string, bool> RunRoutineNow { get; set; } = (string _) => false;

	public Action<string, ClickyInkDocument.Kind, JsonObject> Track { get; set; } = (string _, ClickyInkDocument.Kind _, JsonObject _) =>
	{
	};
}
