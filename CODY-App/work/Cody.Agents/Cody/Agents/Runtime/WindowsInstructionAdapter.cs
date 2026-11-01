using System;

namespace HeyClicky.Agents.Runtime;

internal static class WindowsInstructionAdapter
{
	private static readonly (string Mac, string Windows)[] Replacements = new (string, string)[4]
	{
		("working in the background on their Mac.", "working in the background on their Windows PC."),
		("- Never operate their apps with `open`, AppleScript, `osascript` or other scripted GUI automation; acting on their screen goes through the `computer-use` tools and their yes.", "- Never operate their apps with `Start-Process`, `start`, SendKeys, UI Automation or other scripted GUI automation. You have no screen control on this PC: when something can only be done by clicking in an app, say exactly what they need to click."),
		("- Desktop, Documents, Downloads and their other personal folders each trigger a macOS permission prompt the first time you touch them. Touch only the one folder the task needs, and never scan several to find a file; ask where it is instead.", "- Desktop, Documents, Downloads and their other personal folders are private. Touch only the one folder the task needs, and never scan several to find a file; ask where it is instead."),
		("(for Python: `uv pip install --target tmp/pylib <package>`, then run with `PYTHONPATH=tmp/pylib`)", "(for Python: `uv pip install --target tmp\\pylib <package>`, then run with `$env:PYTHONPATH = \"tmp\\pylib\"`)")
	};

	private const string ShellNote = "\nThis PC runs Windows: your shell is PowerShell, paths use backslashes (C:\\Users\\...), and `~` is $env:USERPROFILE.\n";

	public static string Adapt(string macBrief)
	{
		string text = macBrief.Replace("\r\n", "\n");
		(string, string)[] replacements = Replacements;
		for (int i = 0; i < replacements.Length; i++)
		{
			(string, string) tuple = replacements[i];
			string item = tuple.Item1;
			string item2 = tuple.Item2;
			text = text.Replace(item, item2, StringComparison.Ordinal);
		}
		text = text.Replace("their Mac", "their PC", StringComparison.Ordinal).Replace("this Mac", "this PC", StringComparison.Ordinal);
		int num = text.IndexOf("\n\n", StringComparison.Ordinal);
		if (num >= 0)
		{
			return text.Insert(num, "\n" + "\nThis PC runs Windows: your shell is PowerShell, paths use backslashes (C:\\Users\\...), and `~` is $env:USERPROFILE.\n".TrimEnd('\n'));
		}
		return text + "\nThis PC runs Windows: your shell is PowerShell, paths use backslashes (C:\\Users\\...), and `~` is $env:USERPROFILE.\n";
	}

	public static string AdaptPromptText(string text)
	{
		return text.Replace("while the Mac is awake", "while the PC is awake", StringComparison.Ordinal).Replace("while the Mac is asleep or off", "while the PC is asleep or off", StringComparison.Ordinal).Replace("the Mac", "the PC", StringComparison.Ordinal);
	}
}
