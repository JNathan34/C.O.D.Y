using System;
using System.IO;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using HeyClicky.Core.Browser;
using HeyClicky.Core.Telemetry;

namespace HeyClicky.App.Browser;

public static class ChromeAutoInstall
{
	public static bool IsRunning { get; private set; }

	private static string WhyHere(string browserName)
	{
		return $"This is CODY's own setup, and only you can do it on screen: a job can't use {browserName} until the extension is in. They pressed \"Install for me\", which is their yes to adding it, {browserName}'s own confirmation included.";
	}

	private static string LeaveAlone(string browserName)
	{
		return "Do nothing else in " + browserName + ": don't sign in, don't change settings, don't touch other extensions or open other pages. If something unexpected is in the way (a sign-in, an error, a profile picker you can't place), stop and say what it is.";
	}

	public static string DeveloperModeGoal(string browserName)
	{
		return $"Turn on Developer mode on {browserName}'s Extensions page, which is open in front (if it isn't, open chrome://extensions in {browserName}): the switch at the top right of the page; leave it if it's already on. That's the only step: then end the take-over, and CODY drags the extension in itself from the strip under the window. Say what you're doing first, in one short line on what and why: adding your Chrome extension so their jobs can work in the sites they're signed into, and since it isn't in the Chrome Web Store yet, Chrome needs Developer mode for it. {WhyHere(browserName)} {LeaveAlone(browserName)}";
	}

	public static string Goal(string browserName, string? storeUrl, string extensionFolderPath)
	{
		string value = ((storeUrl != null) ? "Say what you're doing as you go: first one short line on what and why (adding your Chrome extension, so their jobs can work in the sites they're signed into), then a few words before each step (\"Adding it from the Chrome Web Store\", \"Confirming\")." : "Say what you're doing as you go, a few words before each step (\"Loading my extension\", \"Picking its folder\").");
		if (storeUrl == null)
		{
			return $"Load the CODY extension into {browserName}. Its Extensions page (chrome://extensions) is open in front (if it isn't, open that address in {browserName}). 1) Turn on \"Developer mode\" with the switch at the top right of the page (leave it if it's already on). 2) Click \"Load unpacked\", which appears at the top left once Developer mode is on. 3) A folder picker opens: click its Folder box at the bottom, type exactly {extensionFolderPath} and press Enter, then click \"Select Folder\". 4) A CODY card appears on the page: it's done. If {browserName} shows an error for CODY instead, stop and say what it says. {value} {WhyHere(browserName)} {LeaveAlone(browserName)}";
		}
		return $"Add the CODY extension to {browserName} from the Chrome Web Store. Its CODY page is open in front (if it isn't, open {storeUrl} in {browserName}). 1) Click the blue \"Add to Chrome\" button{((browserName == "Chrome") ? "" : $" (in {browserName} it may say \"Add to {browserName}\" or \"Get\")")}. 2) {browserName} asks \"Add CODY?\" in a small dialog: click \"Add extension\". 3) Once {browserName} says CODY was added, or the button turns into \"Remove from Chrome\", it's done. {value} {WhyHere(browserName)} {LeaveAlone(browserName)}";
	}

	public static void InstallByDriving(ChromeSetupFlow flow, string? threadId, bool evenIfConnected, bool? fromStore, Action<bool, bool>? finished = null)
	{
		if (finished == null)
		{
			finished = (bool connected, bool stoppedByUser) =>
			{
				if (!connected && !stoppedByUser)
				{
					flow.ShowHow(afterDrive: true);
				}
			};
		}
		ClickyBrowserBridge bridge = ClickyBrowserBridge.Shared;
		IChromeClickyDrive drive = flow.Drive;
		(string Name, string Executable) browser;
		string process;
		if (drive != null && drive.IsAvailable && !drive.IsDrivingNow && !IsRunning)
		{
			(string, string)? tuple = ChromiumBrowsers.Preferred();
			if (tuple.HasValue)
			{
				browser = tuple.GetValueOrDefault();
				IsRunning = true;
				ClickyAnalytics.TrackChromeJobAction("chrome_install_drive_started", threadId, new JsonObject { ["from_store"] = bridge.StoreListingUrl != null });
				process = Path.GetFileName(browser.Executable);
				RunAsync();
				return;
			}
		}
		finished(arg1: false, arg2: false);
		async Task RunAsync()
		{
			await bridge.ConnectAsync(revealingFolder: false);
			if (bridge.IsConnected && !evenIfConnected)
			{
				await EndedAsync(threadId, stoppedByUser: false, finished);
			}
			else
			{
				await Task.Delay(1500);
				string storeUrl = ((fromStore == false) ? null : bridge.StoreListingUrl);
				if (evenIfConnected)
				{
					if (storeUrl != null)
					{
						bridge.OpenInBrowserExecutable(browser.Executable, storeUrl);
					}
					else
					{
						bridge.OpenExtensionsPage(revealingFolder: false);
					}
					await Task.Delay(1500);
				}
				if (storeUrl == null && flow.ShowStrip())
				{
					if (!drive.DriveForApp(DeveloperModeGoal(browser.Name), process, (ClickyDriveEnding ending) =>
					{
						AfterDeveloperModeAsync(flow, drive, threadId, browser, process, ending, finished);
					}))
					{
						flow.HideStrip();
						IsRunning = false;
						finished(arg1: false, arg2: false);
					}
				}
				else
				{
					DriveWhole(drive, threadId, browser, process, storeUrl, finished);
				}
			}
		}
	}

	private static async Task AfterDeveloperModeAsync(ChromeSetupFlow flow, IChromeClickyDrive drive, string? threadId, (string Name, string Executable) browser, string process, ClickyDriveEnding ending, Action<bool, bool> finished)
	{
		ClickyBrowserBridge bridge = ClickyBrowserBridge.Shared;
		if (ending != ClickyDriveEnding.Finished)
		{
			flow.HideStrip();
			await EndedAsync(threadId, ending == ClickyDriveEnding.UserTookOver, finished);
			return;
		}
		drive.SayVerbatim("Now I'm adding my extension.");
		if (await flow.DragStripOntoBrowserAsync())
		{
			for (int i = 0; i < 32; i++)
			{
				if (bridge.IsConnected)
				{
					break;
				}
				await Task.Delay(250);
			}
		}
		ClickyAnalytics.TrackChromeJobAction(bridge.IsConnected ? "chrome_install_drag_connected" : "chrome_install_drag_fell_back", threadId);
		flow.HideStrip();
		if (bridge.IsConnected)
		{
			await EndedAsync(threadId, stoppedByUser: false, finished);
		}
		else
		{
			DriveWhole(drive, threadId, browser, process, null, finished);
		}
	}

	private static void DriveWhole(IChromeClickyDrive drive, string? threadId, (string Name, string Executable) browser, string process, string? storeUrl, Action<bool, bool> finished)
	{
		ClickyBrowserBridge shared = ClickyBrowserBridge.Shared;
		string extensionFolderPath = shared.SyncInstalledExtensionFolder() ?? shared.InstalledExtensionFolder;
		if (!drive.DriveForApp(Goal(browser.Name, storeUrl, extensionFolderPath), process, (ClickyDriveEnding ending) =>
		{
			EndedAsync(threadId, ending == ClickyDriveEnding.UserTookOver, finished);
		}))
		{
			IsRunning = false;
			finished(arg1: false, arg2: false);
		}
	}

	private static async Task EndedAsync(string? threadId, bool stoppedByUser, Action<bool, bool> finished)
	{
		ClickyBrowserBridge bridge = ClickyBrowserBridge.Shared;
		if (!stoppedByUser)
		{
			for (int i = 0; i < 24; i++)
			{
				if (bridge.IsConnected)
				{
					break;
				}
				await Task.Delay(250);
			}
		}
		IsRunning = false;
		ClickyAnalytics.TrackChromeJobAction(bridge.IsConnected ? "chrome_install_drive_connected" : "chrome_install_drive_fell_back", threadId);
		finished(bridge.IsConnected, stoppedByUser && !bridge.IsConnected);
	}
}
