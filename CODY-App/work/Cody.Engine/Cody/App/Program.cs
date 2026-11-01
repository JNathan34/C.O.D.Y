using System;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using HeyClicky.App.Services;
using HeyClicky.App.Services.Updates;
using HeyClicky.Platform.Win32;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using WinRT;

namespace HeyClicky.App;

public static class Program
{
	public static readonly Stopwatch SinceStart = Stopwatch.StartNew();

	private static bool ownsInstance;
    private static Mutex codyInstance;

	public static string[] Args { get; private set; } = Array.Empty<string>();

	public static event Action<string[]>? ArgumentsForwarded;

	[STAThread]
	private static int Main(string[] args)
	{
        if(args.Contains("--cody-vad-test"))return Cody.CodyVoiceActivity.Test(args.Last());
        if(args.Contains("--cody-wake"))return Cody.CodyKeywordListener.Run(args);
        // Browser helpers can launch this executable directly. In an installed
        // CODY bundle, only the engine and wake worker may start native UI code.
        string codyShell = System.IO.Path.GetFullPath(System.IO.Path.Combine(AppContext.BaseDirectory, "..", "..", "C.O.D.Y.exe"));
        if (!System.IO.File.Exists(codyShell)) codyShell = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "CODY", "C.O.D.Y.exe");
        if (!args.Contains("--cody-engine"))
        {
            if (!System.IO.File.Exists(codyShell)) return 0;
            var launch = new ProcessStartInfo(codyShell) { UseShellExecute = false, CreateNoWindow = true };
            foreach (string argument in args) launch.ArgumentList.Add(argument);
            Process.Start(launch)?.Dispose();
            return 0;
        }
		try
		{
			if(!args.Contains("--cody-engine"))UpdateService.ConfigureVelopack(args).Run();
		}
		catch (Exception ex)
		{
			Log.Warn("updates", "Velopack startup: " + ex.Message);
		}
		Args = args;
		string environmentVariable = Environment.GetEnvironmentVariable("HEYCLICKY_TEST_CULTURE");
		if (environmentVariable != null && environmentVariable.Length > 0)
		{
			CultureInfo.CurrentCulture = (CultureInfo.DefaultThreadCurrentCulture = CultureInfo.GetCultureInfo(environmentVariable));
		}
		bool flag = Environment.GetEnvironmentVariable("HEYCLICKY_OFFSCREEN") == "1";
        if(args.Contains("--cody-engine")){
            string identity=System.Security.Principal.WindowsIdentity.GetCurrent().User.Value;
            codyInstance=new Mutex(true,"Local\\CODY.NativeEngine."+identity+"."+Cody.CodyPaths.PipeName,out bool created);
            if(!created){codyInstance.Dispose();return 0;}
        }
		if (!args.Contains("--cody-engine") && !args.Any((string a) =>
		{
			switch (a)
			{
			case "--demo-states":
			case "--demo-only":
			case "--fakes":
				return true;
			default:
				return false;
			}
		}) && (!flag || (!Enumerable.Contains(args, "--e2e") && !AppPaths.IsOverridden)))
		{
			if (!SingleInstance.TryClaim(args))
			{
				return 0;
			}
			ownsInstance = true;
			SingleInstance.ArgumentsReceived += (string[] forwarded) =>
			{
				ArgumentsForwarded?.Invoke(forwarded);
			};
		}
		CrashReporting.Install();
		GpuScheduling.RaiseForProcess();
		ComWrappersSupport.InitializeComWrappers();
		Application.Start((ApplicationInitializationCallbackParams startParams) =>
		{
			SynchronizationContext.SetSynchronizationContext(new CrashReporting.ReportingSynchronizationContext(DispatcherQueue.GetForCurrentThread()));
			new App();
		});
		if (ownsInstance)
		{
			SingleInstance.Release();
		}
		Log.Info("app", "exited");
		Exit();
		return 0;
	}

	internal static void Exit()
	{
		Thread thread = new Thread(() =>
		{
			Thread.Sleep(TimeSpan.FromSeconds(5L));
			Log.Warn("shutdown", "still exiting 5 s later: terminating");
			Terminate();
		});
		thread.IsBackground = true;
		thread.Name = "ExitWatchdog";
		thread.Start();
		Environment.Exit(0);
	}

	internal static void Terminate()
	{
		TerminateProcess(GetCurrentProcess(), 0u);
	}

	[DllImport("kernel32.dll")]
	private static extern nint GetCurrentProcess();

	[DllImport("kernel32.dll")]
	private static extern bool TerminateProcess(nint process, uint exitCode);

	public static double MillisecondsSinceProcessStart()
	{
		try
		{
			return (DateTime.Now - Process.GetCurrentProcess().StartTime).TotalMilliseconds;
		}
		catch
		{
			return SinceStart.Elapsed.TotalMilliseconds;
		}
	}
}
