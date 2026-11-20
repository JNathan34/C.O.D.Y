using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using HeyClicky.Core.Browser;
using HeyClicky.Core.Platform;
using HeyClicky.Platform.Win32;
using HeyClicky.App.Cody;

namespace HeyClicky.App.Wiring;

public sealed class PlatformDesktopActions : IDesktopActions
{
	private readonly WindowsDesktopActions basic = new WindowsDesktopActions();

	public bool OpenUrl(string url)
	{
		try
		{
			return WindowsBrowserPreference.Current?.TryOpenOverride(url) == true || basic.OpenUrl(url);
		}
		catch (Exception error)
		{
			Log.Warn("Tools", "Could not open link: " + error.Message);
			return false;
		}
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
		if (CodyEngineBridge.EngineMode) return await EnterTextAsync(text, null, CancellationToken.None, requireAutomatic:true);
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

	internal static async Task<TextInsertOutcome> EnterTextAsync(string text, string? words, CancellationToken ct, bool requireAutomatic=false)
	{
		if (!CodyPermissions.CanUseComputer) return new("refused", "Computer control is disabled in Settings > Permissions.");
		if (requireAutomatic && !CodyPermissions.Automatic)
			return new("refused", "Use the normal Computer Use approval flow to type into this field.");
		nint window = GetForegroundWindow();
		GetWindowThreadProcessId(window, out uint pid);
		if (window == 0 || pid == 0) return new("refused", "no_focused_text_field");
		if (CodyDrawingOwner.Own((int)pid)) return new("refused", "own_window");
		try
		{
			using var process=Process.GetProcessById((int)pid);
			if (process.ProcessName.Equals("C.O.D.Y",StringComparison.OrdinalIgnoreCase)) return new("refused","own_window");
		}
		catch (ArgumentException) { return new("refused","no_focused_text_field"); }
		var result = await CodyAccessibilityInput.EnterText(window, text, CodyTextEntryIntent.Replace(words),
			() => window == GetForegroundWindow() && !ct.IsCancellationRequested && CodyPermissions.CanUseComputer,
			CodyTextEntryIntent.Paste(words) ? "ctrl+v" : null, ct).ConfigureAwait(false);
		return result.Handled ? new("inserted") : new(result.Attempted ? "failed" : "refused", result.Reason);
	}

	[DllImport("user32.dll")] private static extern nint GetForegroundWindow();
	[DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint window,out uint pid);

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
