using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace HeyClicky.Agents.Jobs;

public sealed class ClickyWorkFolderFiles
{
	public const string StateFileName = "state.md";

	public const bool WritesStateFiles = false;

	public const string IndexFileName = "WORK.md";

	public static readonly string PreviousNoteRelativePath = Path.Combine(".clicky", "previous-note.md");

	public const string NoteFileName = "note.md";

	public const string RunsBlockStart = "<!-- clicky:runs -->";

	public const string RunsBlockEnd = "<!-- /clicky:runs -->";

	private readonly object gate = new object();

	private readonly Dictionary<string, string> lastWrittenIndexByPath = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

	private Task writes = Task.CompletedTask;

	public void Refresh(IReadOnlyList<ClickyJob> jobs)
	{
		foreach (IGrouping<string, ClickyJob> item in jobs.GroupBy((ClickyJob j) => Path.Combine(Path.GetDirectoryName(j.FolderPath) ?? j.FolderPath, "WORK.md"), StringComparer.OrdinalIgnoreCase))
		{
			string indexPath = item.Key;
			string text = IndexText(item.ToList());
			lock (gate)
			{
				if (lastWrittenIndexByPath.TryGetValue(indexPath, out string value) && value == text)
				{
					continue;
				}
				lastWrittenIndexByPath[indexPath] = text;
				writes = writes.ContinueWith((Task _) =>
				{
					try
					{
						Directory.CreateDirectory(Path.GetDirectoryName(indexPath));
						File.WriteAllText(indexPath, text, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
					}
					catch (Exception ex)
					{
						Log.Warn("Jobs", "WORK.md not written: " + ex.Message);
					}
				}, TaskScheduler.Default);
			}
		}
	}

	public static bool RetireNote(string folderPath)
	{
		string path = Path.Combine(folderPath, "note.md");
		string text;
		try
		{
			if (!File.Exists(path))
			{
				return false;
			}
			text = File.ReadAllText(path);
		}
		catch (Exception)
		{
			return false;
		}
		try
		{
			File.Delete(path);
		}
		catch (Exception)
		{
		}
		if (text.Trim().Length == 0)
		{
			return false;
		}
		string path2 = Path.Combine(folderPath, PreviousNoteRelativePath);
		try
		{
			Directory.CreateDirectory(Path.GetDirectoryName(path2));
			File.WriteAllText(path2, text, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
		}
		catch (Exception ex3)
		{
			Log.Warn("Jobs", "previous-note.md not written: " + ex3.Message);
		}
		return true;
	}

	public static string FolderSlug(string title)
	{
		string text = new string((from ch in title.Normalize(NormalizationForm.FormD)
			where CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark
			select ch).ToArray()).ToLowerInvariant();
		List<string> list = new List<string>();
		StringBuilder stringBuilder = new StringBuilder();
		string text2 = text;
		foreach (char c in text2)
		{
			if (c < '\u0080' && char.IsLetterOrDigit(c))
			{
				stringBuilder.Append(c);
			}
			else if (stringBuilder.Length > 0)
			{
				list.Add(stringBuilder.ToString());
				stringBuilder.Clear();
			}
		}
		if (stringBuilder.Length > 0)
		{
			list.Add(stringBuilder.ToString());
		}
		string text3 = "";
		foreach (string item in list)
		{
			string text4 = ((text3.Length == 0) ? item : (text3 + "-" + item));
			if (text4.Length > 40)
			{
				break;
			}
			text3 = text4;
		}
		return text3;
	}

	private static string RunDate(DateTimeOffset date)
	{
		return date.LocalDateTime.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);
	}

	private static string OneLine(string text, int limit)
	{
		string text2 = string.Join(" ", from l in text.Split('\n', '\r')
			where l.Length > 0
			select l).Trim();
		if (text2.Length > limit)
		{
			return text2.Substring(0, limit - 1).TrimEnd() + "…";
		}
		return text2;
	}

	private static string OutcomeText(ClickyJobOutcome outcome, string? summary)
	{
		string text = ((summary == null) ? "" : (": " + OneLine(summary, 220)));
		return outcome switch
		{
			ClickyJobOutcome.Working => "working now", 
			ClickyJobOutcome.Done => "done" + text, 
			ClickyJobOutcome.Failed => "failed" + text, 
			_ => "stopped by the user" + text, 
		};
	}

	public static string RunsBlock(ClickyJob job)
	{
		IEnumerable<string> second = (job.Runs ?? Array.Empty<ClickyJobRun>()).Select((ClickyJobRun run) => $"- {RunDate(run.StartedAt)} · asked: \"{OneLine(run.Ask, 240)}\" · " + OutcomeText(run.Outcome, run.Summary));
		return string.Join("\n", new string[2] { "<!-- clicky:runs -->", "## Runs (HeyClicky keeps this list, newest last)" }.Concat(second).Append("<!-- /clicky:runs -->"));
	}

	internal static string IndexText(IReadOnlyList<ClickyJob> jobs)
	{
		IEnumerable<string> values = jobs.OrderByDescending((ClickyJob j) => j.Runs?.LastOrDefault()?.StartedAt ?? j.CreatedAt).Select((ClickyJob job) =>
		{
			string fileName = Path.GetFileName(job.FolderPath.TrimEnd(new char[2] { '\\', '/' }));
			DateTimeOffset date = job.FinishedAt ?? job.Runs?.LastOrDefault()?.StartedAt ?? job.CreatedAt;
			return $"- {RunDate(date)} · {OneLine(job.Title, 80)} · {fileName}/ · " + OutcomeText(job.Outcome, job.Summary);
		});
		return "# Work HeyClicky has done for the user\n\nOne folder per piece of work, newest first. In each: output/ (the files it made).\n\n" + string.Join("\n", values) + "\n";
	}
}
