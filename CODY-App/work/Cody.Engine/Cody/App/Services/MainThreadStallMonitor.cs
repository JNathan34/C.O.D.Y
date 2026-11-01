using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using HeyClicky.Core.Telemetry;
using Microsoft.UI.Dispatching;

namespace HeyClicky.App.Services;

public static class MainThreadStallMonitor
{
	private const int PingIntervalMs = 50;

	private const int StallThresholdMs = 100;

	private const int InProgressReportMs = 1000;

	private const int HangReportMs = 2000;

	private const int UnendedHangReportMs = 15000;

	private const int AlwaysLoggedMs = 500;

	private static Thread? thread;

	private static DispatcherQueue? queue;

	private static long outstandingSentTicks;

	private static bool reportedOutstanding;

	private static bool reportedHang;

	public static int StallCount;

	public static int LongestStallMs;

	[DllImport("kernel32.dll")]
	private static extern bool QueryUnbiasedInterruptTime(out long unbiasedTime);

	private static long UnbiasedNow()
	{
		if (!QueryUnbiasedInterruptTime(out var unbiasedTime))
		{
			return Stopwatch.GetTimestamp() * 10000000 / Stopwatch.Frequency;
		}
		return unbiasedTime;
	}

	private static int MillisecondsSince(long unbiasedTicks)
	{
		return (int)Math.Min(2147483647L, (UnbiasedNow() - unbiasedTicks) / 10000);
	}

	private static void ReportHang(int milliseconds, bool ended)
	{
		if (!Debugger.IsAttached)
		{
			string distinguishingKey;
			if (ended)
			{
				if (milliseconds < 5000)
				{
					distinguishingKey = "2-5s";
				}
				else
				{
					distinguishingKey = ((milliseconds < 15000) ? "5-15s" : "15s+");
				}
			}
			else
			{
				distinguishingKey = "unended";
			}
			ClickyAnalytics.ReportInternalError("main_thread", "app_hanging", null, $"UI thread blocked {(ended ? "" : "for at least ")}{milliseconds} ms, {Program.MillisecondsSinceProcessStart() / 1000.0:0} s after launch", CrashReportLevel.Warning, distinguishingKey);
		}
	}

	public static void Start(DispatcherQueue uiQueue)
	{
		if (thread == null)
		{
			queue = uiQueue;
			thread = new Thread(Run)
			{
				IsBackground = true,
				Name = "HeyClicky UI stall watchdog",
				Priority = ThreadPriority.BelowNormal
			};
			thread.Start();
			Log.Info("stall", $"UI-thread stall watchdog armed (threshold {100} ms, hang report at {2000} ms)");
		}
	}

	private static void Run()
	{
		while (true)
		{
			Thread.Sleep(50);
			try
			{
				Tick();
			}
			catch (Exception ex)
			{
				Log.Warn("stall", "watchdog tick: " + ex.Message);
			}
		}
	}

	private static void Tick()
	{
		long num = Interlocked.Read(in outstandingSentTicks);
		if (num != 0L)
		{
			int num2 = MillisecondsSince(num);
			if (num2 >= 1000 && !reportedOutstanding)
			{
				reportedOutstanding = true;
				Log.Info("stall", $"[stall] UI thread unresponsive for {num2} ms and counting (ping sent {Stamp(DateTime.Now.AddMilliseconds(-num2))})");
			}
			if (num2 >= 15000 && !Volatile.Read(in reportedHang))
			{
				Volatile.Write(ref reportedHang, value: true);
				ReportHang(num2, ended: false);
			}
		}
		else
		{
			long sentAt = UnbiasedNow();
			DateTime sentWall = DateTime.Now;
			Interlocked.Exchange(ref outstandingSentTicks, sentAt);
			reportedOutstanding = false;
			Volatile.Write(ref reportedHang, value: false);
			DispatcherQueue? dispatcherQueue = queue;
			if ((object)dispatcherQueue == null || !dispatcherQueue.TryEnqueue(DispatcherQueuePriority.Normal, () =>
			{
				int num3 = MillisecondsSince(sentAt);
				Interlocked.Exchange(ref outstandingSentTicks, 0L);
				if (num3 >= 100)
				{
					if (num3 >= 2000 && !Volatile.Read(in reportedHang))
					{
						Volatile.Write(ref reportedHang, value: true);
						ReportHang(num3, ended: true);
					}
					Interlocked.Increment(ref StallCount);
					if (num3 > LongestStallMs)
					{
						LongestStallMs = num3;
					}
					if (num3 >= 500)
					{
						Log.Info("stall", $"[stall] UI thread blocked {num3} ms ({Stamp(sentWall)} → {Stamp(DateTime.Now)})");
					}
				}
			}))
			{
				Interlocked.Exchange(ref outstandingSentTicks, 0L);
			}
		}
	}

	private static string Stamp(DateTime time)
	{
		return time.ToString("HH:mm:ss.fff");
	}
}
