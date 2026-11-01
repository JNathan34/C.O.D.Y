using System.Threading.Tasks;

namespace HeyClicky.Core.Platform;

public interface IDesktopActions
{
	bool OpenUrl(string url);

	bool CopyToClipboard(string text);

	Task<string> TypeIntoFocusedFieldAsync(string text);

	(string? DisplayName, string? ProcessName) FrontApplication();

	async Task<TextInsertOutcome> InsertIntoFocusedFieldAsync(string text)
	{
		string text2 = await TypeIntoFocusedFieldAsync(text).ConfigureAwait(continueOnCapturedContext: false);
		TextInsertOutcome result;
		if (text2 == "typed")
		{
			result = new TextInsertOutcome("inserted");
		}
		else
		{
			result = ((!(text2 == "copied_to_clipboard")) ? new TextInsertOutcome("refused", "unsafe_target") : new TextInsertOutcome("copied_to_clipboard"));
		}
		return result;
	}
}
