using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.Media.Audio;

namespace HeyClicky.Platform.Audio;

internal abstract class WasapiRenderStream : IDisposable
{
	protected readonly int SampleRate;

	protected readonly int BytesPerFrame;

	private readonly long bufferDurationHns;

	private readonly string streamName;

	private Thread? renderThread;

	private readonly AutoResetEvent wakeEvent = new AutoResetEvent(initialState: false);

	private readonly AutoResetEvent stopRequestedEvent = new AutoResetEvent(initialState: false);

	private readonly AutoResetEvent deviceChangedEvent = new AutoResetEvent(initialState: false);

	private volatile bool flushRequested;

	private volatile bool startWithSilenceRequested;

	private volatile bool disposed;

	protected const double IdleStopAfterSeconds = 1.5;

	private bool loggedNoDevice;

	private AudioEndpointInfo? openDevice;

	private (AudioEndpointInfo From, int DroppedBuffers, bool WasRunning)? pendingRouteChange;

	private bool deviceNotificationsWork;

	protected abstract bool HasPendingAudio { get; }

	protected virtual TimeSpan PrebufferWait => TimeSpan.Zero;

	protected WasapiRenderStream(string streamName, int sampleRate, int bytesPerFrame, int bufferMilliseconds)
	{
		this.streamName = streamName;
		SampleRate = sampleRate;
		BytesPerFrame = bytesPerFrame;
		bufferDurationHns = (long)bufferMilliseconds * 10000L;
		AudioDevices.PreferenceChanged += OnDevicePreferenceChanged;
	}

	private void OnDevicePreferenceChanged(bool capture)
	{
		if (capture || disposed)
		{
			return;
		}
		try
		{
			deviceChangedEvent.Set();
		}
		catch (ObjectDisposedException)
		{
		}
	}

	protected abstract void InitializeClient(IAudioClient client, long bufferDurationHns);

	protected abstract int Fill(Span<byte> destination, int frameCount);

	protected virtual void OnFramesWritten(long streamFramesAfterWrite, int realFrames, int totalFrames)
	{
	}

	protected virtual void OnClockPosition(long playedStreamFrames)
	{
	}

	protected virtual void OnStreamReset(bool causedByFlush)
	{
	}

	public void EnsureStarted()
	{
		if (renderThread != null || disposed)
		{
			return;
		}
		lock (wakeEvent)
		{
			if (renderThread == null)
			{
				renderThread = new Thread(RenderThreadMain)
				{
					IsBackground = true,
					Name = "HeyClicky " + streamName + " render",
					Priority = ThreadPriority.Highest
				};
				renderThread.SetApartmentState(ApartmentState.MTA);
				renderThread.Start();
			}
		}
	}

	public void Wake()
	{
		EnsureStarted();
		wakeEvent.Set();
	}

	public void StartWithSilence()
	{
		startWithSilenceRequested = true;
		Wake();
	}

	public void RequestDeviceFlush()
	{
		flushRequested = true;
		wakeEvent.Set();
	}

	public virtual void Dispose()
	{
		if (!disposed)
		{
			disposed = true;
			AudioDevices.PreferenceChanged -= OnDevicePreferenceChanged;
			stopRequestedEvent.Set();
			renderThread?.Join(2000);
			wakeEvent.Dispose();
			stopRequestedEvent.Dispose();
			deviceChangedEvent.Dispose();
		}
	}

	private void RenderThreadMain()
	{
		uint TaskIndex = 0u;
		using (PInvoke.AvSetMmThreadCharacteristics("Audio", ref TaskIndex))
		{
			IMMDeviceEnumerator iMMDeviceEnumerator = null;
			DefaultDeviceChangeListener defaultDeviceChangeListener = null;
			try
			{
				iMMDeviceEnumerator = CoreAudio.CreateDeviceEnumerator();
				defaultDeviceChangeListener = new DefaultDeviceChangeListener(EDataFlow.eRender, ERole.eConsole, deviceChangedEvent);
				try
				{
					iMMDeviceEnumerator.RegisterEndpointNotificationCallback(defaultDeviceChangeListener);
					deviceNotificationsWork = true;
				}
				catch (Exception ex)
				{
					defaultDeviceChangeListener = null;
					Log.Warn("AudioOut", "device-change notifications unavailable: " + ex.Message);
				}
				while (!disposed && !RunOneDeviceSession(iMMDeviceEnumerator) && WaitHandle.WaitAny(new WaitHandle[3] { stopRequestedEvent, deviceChangedEvent, wakeEvent }, 1000) != 0)
				{
				}
			}
			catch (Exception ex2)
			{
				Log.Error("AudioOut", streamName + " render thread failed", ex2);
			}
			finally
			{
				if (defaultDeviceChangeListener != null && iMMDeviceEnumerator != null)
				{
					try
					{
						iMMDeviceEnumerator.UnregisterEndpointNotificationCallback(defaultDeviceChangeListener);
					}
					catch
					{
					}
				}
				CoreAudio.ReleaseComObject(iMMDeviceEnumerator);
			}
		}
	}

	private unsafe bool RunOneDeviceSession(IMMDeviceEnumerator deviceEnumerator)
	{
		IMMDevice iMMDevice = AudioDevices.Resolve(deviceEnumerator, EDataFlow.eRender, ERole.eConsole, out var usedPreferred);
		bool flag = false;
		if (iMMDevice == null)
		{
			return RunWithoutDevice();
		}
		IAudioClient audioClient = null;
		IAudioRenderClient audioRenderClient = null;
		IAudioClock audioClock = null;
		using AutoResetEvent autoResetEvent = new AutoResetEvent(initialState: false);
		bool flag2 = false;
		try
		{
			audioClient = CoreAudio.ActivateAudioClient(iMMDevice);
			InitializeClient(audioClient, bufferDurationHns);
			audioClient.SetEventHandle(new HANDLE(autoResetEvent.SafeWaitHandle.DangerousGetHandle()));
			audioClient.GetBufferSize(out var pNumBufferFrames);
			audioRenderClient = CoreAudio.GetService<IAudioRenderClient>(audioClient, CoreAudio.IID_IAudioRenderClient);
			audioClock = CoreAudio.GetService<IAudioClock>(audioClient, CoreAudio.IID_IAudioClock);
			audioClock.GetFrequency(out var pu64Frequency);
			Log.Info("AudioOut", $"{streamName}: opened {(usedPreferred ? "picked" : "default")} render device, buffer {pNumBufferFrames} frames @ {SampleRate} Hz");
			AudioEndpointInfo to = AudioEndpoints.Describe(iMMDevice);
			flag = true;
			CompletePendingRouteChange(to, restartSucceeded: true);
			openDevice = to;
			long num = 0L;
			long num2 = 0L;
			WaitHandle[] waitHandles = new WaitHandle[3] { stopRequestedEvent, deviceChangedEvent, wakeEvent };
			WaitHandle[] waitHandles2 = new WaitHandle[4] { stopRequestedEvent, deviceChangedEvent, wakeEvent, autoResetEvent };
			while (true)
			{
				if (flushRequested)
				{
					flushRequested = false;
					if (flag2)
					{
						audioClient.Stop();
						flag2 = false;
					}
					audioClient.Reset();
					num = 0L;
					OnStreamReset(causedByFlush: true);
				}
				if (!flag2)
				{
					bool flag3 = startWithSilenceRequested;
					startWithSilenceRequested = false;
					if (!HasPendingAudio && !flag3)
					{
						switch (WaitHandle.WaitAny(waitHandles))
						{
						case 0:
							return true;
						case 1:
							NotePendingRouteChange(audioClient, wasRunning: false);
							Log.Info("AudioOut", streamName + ": default device changed; reopening");
							return false;
						}
						continue;
					}
					if (!flag3 && PrebufferWait > TimeSpan.Zero && stopRequestedEvent.WaitOne(PrebufferWait))
					{
						break;
					}
					if (!flushRequested)
					{
						num += WriteAvailable(audioClient, audioRenderClient, pNumBufferFrames, num, out var _);
						audioClient.Start();
						flag2 = true;
						num2 = 0L;
					}
					continue;
				}
				startWithSilenceRequested = false;
				switch (WaitHandle.WaitAny(waitHandles2, 500))
				{
				case 0:
					audioClient.Stop();
					return true;
				case 1:
					NotePendingRouteChange(audioClient, wasRunning: true);
					audioClient.Stop();
					Log.Info("AudioOut", streamName + ": default device changed; reopening");
					return false;
				}
				if (!flushRequested)
				{
					audioClock.GetPosition(out var pu64Position, null);
					OnClockPosition((long)((ulong)((long)pu64Position * (long)SampleRate) / Math.Max(1uL, pu64Frequency)));
					int num3 = WriteAvailable(audioClient, audioRenderClient, pNumBufferFrames, num, out var realFrames2);
					num += num3;
					num2 = ((realFrames2 > 0) ? 0 : (num2 + num3));
					if (num2 >= (long)(1.5 * (double)SampleRate) && !HasPendingAudio)
					{
						audioClient.Stop();
						audioClient.Reset();
						flag2 = false;
						num = 0L;
						OnStreamReset(causedByFlush: false);
					}
				}
			}
			return true;
		}
		catch (Exception ex) when (CoreAudio.IsDeviceGone(ex))
		{
			if (flag)
			{
				NotePendingRouteChange(audioClient, flag2);
			}
			else
			{
				CompletePendingRouteChange(null, restartSucceeded: false);
			}
			Log.Warn("AudioOut", $"{streamName}: render device lost (0x{ex.HResult:X8}); reopening");
			OnStreamReset(causedByFlush: false);
			return false;
		}
		catch (COMException ex2)
		{
			if (!flag)
			{
				CompletePendingRouteChange(null, restartSucceeded: false);
			}
			Log.Error("AudioOut", $"{streamName}: render stream error (0x{ex2.HResult:X8})", ex2);
			OnStreamReset(causedByFlush: false);
			return false;
		}
		finally
		{
			CoreAudio.ReleaseComObject(audioClock);
			CoreAudio.ReleaseComObject(audioRenderClient);
			CoreAudio.ReleaseComObject(audioClient);
			CoreAudio.ReleaseComObject(iMMDevice);
		}
	}

	private unsafe int WriteAvailable(IAudioClient audioClient, IAudioRenderClient renderClient, uint bufferFrameCount, long streamFramesBefore, out int realFrames)
	{
		audioClient.GetCurrentPadding(out var pNumPaddingFrames);
		int num = (int)(bufferFrameCount - pNumPaddingFrames);
		realFrames = 0;
		if (num <= 0)
		{
			return 0;
		}
		byte* pointer = default;
		renderClient.GetBuffer((uint)num, &pointer);
		Span<byte> destination = new Span<byte>(pointer, num * BytesPerFrame);
		realFrames = Fill(destination, num);
		if (realFrames < num)
		{
			int num2 = realFrames * BytesPerFrame;
			destination.Slice(num2, destination.Length - num2).Clear();
		}
		renderClient.ReleaseBuffer((uint)num, 0u);
		OnFramesWritten(streamFramesBefore + num, realFrames, num);
		return num;
	}

	private bool RunWithoutDevice()
	{
		if (!loggedNoDevice)
		{
			loggedNoDevice = true;
			Log.Warn("AudioOut", streamName + ": no render device; playing against the wall clock");
		}
		CompletePendingRouteChange(null, restartSucceeded: false);
		openDevice = null;
		int num = SampleRate * 10 / 1000;
		byte[] array = new byte[num * BytesPerFrame];
		long num2 = 0L;
		long num3 = 0L;
		long timestamp = Stopwatch.GetTimestamp();
		bool flag = false;
		WaitHandle[] waitHandles = new WaitHandle[3] { stopRequestedEvent, deviceChangedEvent, wakeEvent };
		while (true)
		{
			if (flushRequested)
			{
				flushRequested = false;
				flag = false;
				num2 = 0L;
				OnStreamReset(causedByFlush: true);
			}
			if (!flag)
			{
				if (!HasPendingAudio)
				{
					switch (WaitHandle.WaitAny(waitHandles, deviceNotificationsWork ? (-1) : 2000))
					{
					case 0:
						return true;
					case 1:
					case 258:
						return false;
					}
					continue;
				}
				flag = true;
				num3 = 0L;
				timestamp = Stopwatch.GetTimestamp();
			}
			switch (WaitHandle.WaitAny(waitHandles, 10))
			{
			case 0:
				return true;
			case 1:
				OnStreamReset(causedByFlush: false);
				return false;
			}
			if (!flushRequested)
			{
				long num4 = (long)(Stopwatch.GetElapsedTime(timestamp).TotalSeconds * (double)SampleRate);
				OnClockPosition(Math.Min(num4, num2));
				while (num2 < num4 + num)
				{
					Array.Clear(array);
					int num5 = Fill(array, num);
					num2 += num;
					OnFramesWritten(num2, num5, num);
					num3 = ((num5 > 0) ? 0 : (num3 + num));
				}
				if (num3 >= (long)(1.5 * (double)SampleRate) && !HasPendingAudio)
				{
					flag = false;
					num2 = 0L;
					OnStreamReset(causedByFlush: false);
				}
			}
		}
	}

	private void NotePendingRouteChange(IAudioClient? audioClient, bool wasRunning)
	{
		AudioEndpointInfo audioEndpointInfo = openDevice;
		if ((object)audioEndpointInfo == null)
		{
			return;
		}
		(AudioEndpointInfo, int, bool)? tuple = pendingRouteChange;
		if (tuple.HasValue)
		{
			return;
		}
		int item = 0;
		try
		{
			if (wasRunning && audioClient != null)
			{
				audioClient.GetCurrentPadding(out var pNumPaddingFrames);
				item = (int)Math.Ceiling((double)pNumPaddingFrames / ((double)SampleRate / 100.0));
			}
		}
		catch (COMException)
		{
		}
		pendingRouteChange = (audioEndpointInfo, item, wasRunning);
	}

	private void CompletePendingRouteChange(AudioEndpointInfo? to, bool restartSucceeded)
	{
		(AudioEndpointInfo, int, bool)? tuple = pendingRouteChange;
		if (tuple.HasValue)
		{
			(AudioEndpointInfo, int, bool) valueOrDefault = tuple.GetValueOrDefault();
			pendingRouteChange = null;
			AudioOutputRoute.Raise(new AudioOutputRouteChange(streamName, valueOrDefault.Item1.TransportCategory, valueOrDefault.Item1.Name, to?.TransportCategory ?? "none", to?.Name ?? "none", valueOrDefault.Item2, valueOrDefault.Item3, restartSucceeded));
		}
	}
}
