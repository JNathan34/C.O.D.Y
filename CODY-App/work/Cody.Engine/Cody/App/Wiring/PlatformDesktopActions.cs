using System;
using System.Threading.Tasks;
using HeyClicky.Core.Platform;
using HeyClicky.Platform.Win32;

namespace HeyClicky.App.Wiring;

public sealed class PlatformDesktopActions : IDesktopActions
{
	private readonly WindowsDesktopActions basic = new WindowsDesktopActions();

	public bool OpenUrl(string url)
	{
		return basic.OpenUrl(url);
	}

	public bool CopyToClipboard(string text)
	{
		return basic.CopyToClipboard(text);
	}

	public async Task<string> TypeIntoFocusedFieldAsync(string text)
	{
		string status = (await InsertIntoFocusedFieldAsync(text).ConfigureAwait(continueOnCapturedContext: false)).Status;
		string result;
		if (status == "inserted")
		{
			result = "typed";
		}
		else
		{
			result = ((!(status == "copied_to_clipboard")) ? "refused" : "copied_to_clipboard");
		}
		return result;
	}

	public async Task<TextInsertOutcome> InsertIntoFocusedFieldAsync(string text)
	{
		UiaPageText.FocusTarget target = await UiaPageText.FocusedTargetAsync().ConfigureAwait(continueOnCapturedContext: false);
		if ((object)target == null || !target.HasFocus)
		{
			return new TextInsertOutcome("refused", "no_focused_text_field");
		}
		if (target.ProcessId == Environment.ProcessId)
		{
			return new TextInsertOutcome("refused", "own_window");
		}
		if (target.IsPassword)
		{
			return new TextInsertOutcome("refused", "secure_field");
		}
		if (target.IsAddressBar)
		{
			return new TextInsertOutcome("refused", "address_bar");
		}
		bool flag = await TextInsertion.PasteTextAsync(text).ConfigureAwait(continueOnCapturedContext: false);
		Log.Info("Desktop", $"insert into {target.AppName ?? "?"} ({target.ControlType}): {(flag ? "pasted" : "clipboard write failed")}");
		return flag ? new TextInsertOutcome("inserted", null, ForegroundAppInfo.CaptureUserApp()?.AppName ?? target.AppName) : new TextInsertOutcome("failed", "clipboard_unavailable");
	}

	public (string? DisplayName, string? ProcessName) FrontApplication()
	{
		ForegroundApp foregroundApp = ForegroundAppInfo.CaptureUserApp();
		if ((object)foregroundApp != null)
		{
			return (DisplayName: foregroundApp.AppName, ProcessName: foregroundApp.ProcessName);
		}
		return (DisplayName: null, ProcessName: null);
	}
}
