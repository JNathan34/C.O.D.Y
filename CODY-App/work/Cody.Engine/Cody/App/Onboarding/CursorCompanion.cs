using System;
using System.Collections.Generic;
using System.IO;
using System.Numerics;
using System.Text.Json.Nodes;
using HeyClicky.App.Design;
using HeyClicky.App.Interop;
using HeyClicky.App.Shell;
using HeyClicky.App.UI;
using HeyClicky.Core.Telemetry;
using HeyClicky.Platform.Audio;
using Microsoft.UI.Composition;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Hosting;
using Windows.Media.Core;
using Windows.Media.Playback;

namespace HeyClicky.App.Onboarding;

public sealed class CursorCompanion
{
	public sealed record Cue(double AtSeconds, Action Fire);

	public const double VideoWidth = 330.0;

	public const double VideoHeight = 186.0;

	private const double StageWidth = 440.0;

	private const double StageHeight = 320.0;

	private readonly OverlayWindow window;

	private readonly DispatcherQueue dq;

	private readonly DispatcherQueueTimer frame;

	private readonly Canvas stage = new Canvas
	{
		Width = 440.0,
		Height = 320.0
	};

	private readonly Grid videoCard = new Grid
	{
		Width = 330.0,
		Height = 186.0,
		Opacity = 0.0
	};

	private readonly TextBlock countdown;

	private readonly Grid countdownHost;

	private readonly Func<string> tint;

	private MediaPlayer? player;

	private double x;

	private double y;

	private double vx;

	private double vy;

	private bool placed;

	private bool visible;

	private long lastTick;

	private double hintOpacity;

	private int meterTicks;

	private readonly HashSet<double> firedCues = new HashSet<double>();

	private IReadOnlyList<Cue> cues = Array.Empty<Cue>();

	private Action? videoEnded;

	private DispatcherQueueTimer? videoTimer;

	private double countdownFrom = 60.0;

	private string videoAssetName = "";

	private string videoSourceName = "bundled";

	private bool videoStartedTracked;

	private bool onboardingAnalytics = true;

	private bool escapeWasDown;

	private long firstEscapeAt;

	private readonly HashSet<DispatcherQueueTimer> pending = new HashSet<DispatcherQueueTimer>();

	public bool IsPlayingVideo => (object)player != null;

	internal OverlayWindow WindowForSnapshot => window;

	public MediaPlayer? CurrentPlayer => player;

	public (double Position, double Duration)? VideoProgress
	{
		get
		{
			MediaPlayer mediaPlayer = player;
			if ((object)mediaPlayer == null)
			{
				return null;
			}
			return (mediaPlayer.PlaybackSession.Position.TotalSeconds, mediaPlayer.PlaybackSession.NaturalDuration.TotalSeconds);
		}
	}

	private bool IsVideoOnScreen
	{
		get
		{
			if ((object)player != null)
			{
				return videoEnded != null;
			}
			return false;
		}
	}

	private double VideoRemainingSeconds
	{
		get
		{
			MediaPlayer mediaPlayer = player;
			if ((object)mediaPlayer == null)
			{
				return 0.0;
			}
			try
			{
				MediaPlaybackSession playbackSession = mediaPlayer.PlaybackSession;
				return Math.Max(0.0, (playbackSession.NaturalDuration - playbackSession.Position).TotalSeconds);
			}
			catch
			{
				return 0.0;
			}
		}
	}

	public event Action? DoubleEscape;

	public CursorCompanion(bool excludeFromCapture, Func<string> cursorColorHex)
	{
		tint = cursorColorHex;
		dq = DispatcherQueue.GetForCurrentThread();
		window = new OverlayWindow("HeyClicky Cursor", excludeFromCapture, clickThroughEverywhere: true);
		window.Root.Children.Add(stage);
		window.Root.HorizontalAlignment = HorizontalAlignment.Left;
		window.Root.VerticalAlignment = VerticalAlignment.Top;
		ShadowLayer item = new ShadowLayer(10.0, DS.Black(0.4), 12.0, 6.0);
		videoCard.Children.Add(item);
		Canvas.SetLeft(videoCard, 10.0);
		Canvas.SetTop(videoCard, 18.0);
		stage.Children.Add(videoCard);
		countdown = new TextBlock
		{
			FontSize = 11.0,
			FontWeight = FontWeights.Medium,
			Foreground = Ui.Brush(DS.White(0.85)),
			Width = 330.0,
			TextAlignment = TextAlignment.Right,
			IsTextScaleFactorEnabled = false
		};
		countdownHost = new Grid
		{
			Opacity = 0.0,
			IsHitTestVisible = false
		};
		Grid countdownShadow = new Grid();
		countdownHost.Children.Add(countdownShadow);
		countdownHost.Children.Add(countdown);
		countdown.Loaded += (object _, RoutedEventArgs _) =>
		{
			Compositor compositor = Ui.Compositor;
			DropShadow dropShadow = compositor.CreateDropShadow();
			dropShadow.Color = DS.Black(0.6);
			dropShadow.BlurRadius = 8f;
			dropShadow.Offset = new Vector3(0f, 1f, 0f);
			dropShadow.Mask = countdown.GetAlphaMask();
			SpriteVisual spriteVisual = compositor.CreateSpriteVisual();
			spriteVisual.Shadow = dropShadow;
			spriteVisual.RelativeSizeAdjustment = Vector2.One;
			ElementCompositionPreview.SetElementChildVisual(countdownShadow, spriteVisual);
		};
		Canvas.SetLeft(countdownHost, 10.0);
		Canvas.SetTop(countdownHost, 210.0);
		stage.Children.Add(countdownHost);
		frame = dq.CreateTimer();
		frame.Interval = TimeSpan.FromMilliseconds(15L, 0L);
		frame.Tick += (DispatcherQueueTimer _, object _) =>
		{
			Follow();
		};
	}

	private void EnsureShown()
	{
		if (!visible)
		{
			visible = true;
			placed = false;
			Follow();
			window.ShowNoActivate();
			frame.Start();
		}
	}

	private void HideIfEmpty()
	{
		if ((object)player == null)
		{
			visible = false;
			frame.Stop();
			window.HideWindow();
		}
	}

	private void Follow()
	{
		Native.GetCursorPos(out var p);
		double scale = Displays.UnderCursor().Scale;
		double num = (double)p.X + 35.0 * scale;
		double num2 = (double)p.Y + 25.0 * scale;
		long tickCount = Environment.TickCount64;
		double num3 = ((lastTick == 0L) ? 0.016 : Math.Clamp((double)(tickCount - lastTick) / 1000.0, 0.001, 0.05));
		lastTick = tickCount;
		if (!placed || Math.Abs(num - x) > 1200.0 * scale || Math.Abs(num2 - y) > 1200.0 * scale)
		{
			x = num;
			y = num2;
			vx = (vy = 0.0);
			placed = true;
		}
		else
		{
			double num4 = Math.Pow(Math.PI * 10.0, 2.0);
			double num5 = Math.PI * 12.0;
			vx += (num4 * (num - x) - num5 * vx) * num3;
			vy += (num4 * (num2 - y) - num5 * vy) * num3;
			x += vx * num3;
			y += vy * num3;
		}
		window.PlacePx((int)Math.Round(x - 40.0 * scale + 40.0 * scale), (int)Math.Round(y), (int)Math.Round(440.0 * scale), (int)Math.Round(320.0 * scale));
		EscapeWatch();
	}

	public bool PlayVideo(string path, IReadOnlyList<Cue> videoCues, Action ended, double audioRampSeconds = 2.0, double countdownFromSeconds = 60.0, double hintDelaySeconds = 5.0, bool onboardingAnalytics = true)
	{
		if (!File.Exists(path))
		{
			Log.Warn("video", "missing " + path);
			return false;
		}
		return PlayVideo(CreatePlayer(new Uri(path), muted: false), "Assets/Video/" + Path.GetFileName(path), "bundled", videoCues, ended, null, audioRampSeconds, countdownFromSeconds, hintDelaySeconds, onboardingAnalytics);
	}

	public static MediaPlayer CreatePlayer(Uri source, bool muted)
	{
		return new MediaPlayer
		{
			Source = MediaSource.CreateFromUri(source),
			AudioCategory = MediaPlayerAudioCategory.Media,
			Volume = 0.0,
			IsMuted = muted,
			AutoPlay = false
		};
	}

	public bool PlayVideo(MediaPlayer mp, string assetUrl, string sourceName, IReadOnlyList<Cue> videoCues, Action ended, Func<MediaPlayerFailedEventArgs, bool>? failed, double audioRampSeconds = 2.0, double countdownFromSeconds = 60.0, double hintDelaySeconds = 5.0, bool onboardingAnalytics = true)
	{
		StopVideo();
		cues = videoCues;
		firedCues.Clear();
		videoEnded = ended;
		hintOpacity = 0.0;
		countdownFrom = countdownFromSeconds;
		videoAssetName = assetUrl;
		videoSourceName = sourceName;
		videoStartedTracked = !onboardingAnalytics;
		this.onboardingAnalytics = onboardingAnalytics;
		mp.IsMuted = Environment.GetEnvironmentVariable("HEYCLICKY_MUTE_AUDIO") == "1";
		mp.Volume = 0.0;
		player = mp;
		RoundedVideoView roundedVideoView = new RoundedVideoView(330.0, 186.0, 10.0);
		roundedVideoView.Attach(mp);
		while (videoCard.Children.Count > 1)
		{
			RemoveVideoView();
		}
		videoCard.Children.Add(roundedVideoView);
		mp.MediaEnded += (MediaPlayer _, object _) =>
		{
			dq.TryEnqueue(() =>
			{
				Log.Info("video", "played to the end");
				if (player == mp && videoEnded != null && this.onboardingAnalytics)
				{
					ClickyAnalytics.TrackOnboardingVideoCompleted();
				}
				FinishVideo();
			});
		};
		mp.MediaFailed += (MediaPlayer _, MediaPlayerFailedEventArgs e) =>
		{
			dq.TryEnqueue(() =>
			{
				Log.Warn("video", $"failed: {e.Error} {e.ErrorMessage}");
				if (!(player != mp))
				{
					Func<MediaPlayerFailedEventArgs, bool>? func = failed;
					if (func == null || !func(e))
					{
						FinishVideo();
					}
				}
			});
		};
		mp.PlaybackSession.PlaybackStateChanged += (MediaPlaybackSession sess, object _) =>
		{
			Log.Info("video", $"state {sess.PlaybackState} at {sess.Position.TotalSeconds:0.0}s / {sess.NaturalDuration.TotalSeconds:0.0}s");
		};
		EnsureShown();
		videoCard.Opacity = 0.0;
		mp.Play();
		Log.Info("video", $"playing {assetUrl} ({sourceName})");
		After(0.2, () =>
		{
			if (!(player != mp))
			{
				Anim.Opacity(videoCard, 1f, 2.0, Easing.EaseInOut(Ui.Compositor));
				RampVolume(mp, audioRampSeconds);
			}
		});
		if (hintDelaySeconds <= 0.0)
		{
			hintOpacity = 1.0;
		}
		else
		{
			After(hintDelaySeconds, () =>
			{
				if (player == mp)
				{
					hintOpacity = 1.0;
				}
			});
		}
		videoTimer = dq.CreateTimer();
		videoTimer.Interval = TimeSpan.FromMilliseconds(100L, 0L);
		videoTimer.Tick += (DispatcherQueueTimer _, object _) =>
		{
			VideoTick(mp);
		};
		videoTimer.Start();
		return true;
	}

	private void RampVolume(MediaPlayer mp, double seconds)
	{
		int step = 0;
		DispatcherQueueTimer t = dq.CreateTimer().Rooted();
		t.Interval = TimeSpan.FromSeconds(seconds / 20.0);
		t.Tick += (DispatcherQueueTimer _, object _) =>
		{
			step++;
			if (player != mp)
			{
				t.Stop();
				pending.Remove(t);
			}
			else
			{
				mp.Volume = Math.Min(1.0, (double)step / 20.0);
				if (step >= 20)
				{
					t.Stop();
					pending.Remove(t);
				}
			}
		};
		pending.Add(t);
		t.Start();
	}

	private void VideoTick(MediaPlayer mp)
	{
		if (player != mp)
		{
			return;
		}
		MediaPlaybackSession playbackSession = mp.PlaybackSession;
		double totalSeconds = playbackSession.Position.TotalSeconds;
		double totalSeconds2 = playbackSession.NaturalDuration.TotalSeconds;
		if (!videoStartedTracked && totalSeconds >= 0.1)
		{
			videoStartedTracked = true;
			JsonObject jsonObject = new JsonObject();
			jsonObject["video_kind"] = "onboarding";
			jsonObject["phase"] = "playback";
			jsonObject["asset_url"] = videoAssetName;
			jsonObject["player_status"] = "ready_to_play";
			jsonObject["item_status"] = "ready_to_play";
			JsonObject jsonObject2 = jsonObject;
			string text;
			switch (playbackSession.PlaybackState)
			{
			case MediaPlaybackState.Playing:
				text = "playing";
				break;
			case MediaPlaybackState.Paused:
				text = "paused";
				break;
			case MediaPlaybackState.Opening:
			case MediaPlaybackState.Buffering:
				text = "waiting_to_play";
				break;
			default:
				text = "none";
				break;
			}
			jsonObject2["time_control_status"] = text;
			jsonObject["source"] = videoSourceName;
			ClickyAnalytics.TrackOnboardingVideoStarted(jsonObject);
		}
		foreach (Cue cue in cues)
		{
			if (totalSeconds >= cue.AtSeconds && firedCues.Add(cue.AtSeconds))
			{
				Log.Info("video", $"cue @{cue.AtSeconds:0}s");
				try
				{
					cue.Fire();
				}
				catch (Exception ex)
				{
					Log.Warn("video", $"cue @{cue.AtSeconds}: {ex.Message}");
				}
			}
		}
		if (++meterTicks % 50 == 0)
		{
			Log.Info("video", $"at {totalSeconds:0.0}s: volume {mp.Volume:0.00}{(mp.IsMuted ? " (muted)" : "")}, output peak {SystemVolume.Peak():0.000}, system level {SystemVolume.EffectiveLevel():0.00}");
		}
		double num = totalSeconds2 - totalSeconds;
		bool flag = totalSeconds2 > 0.0 && num <= countdownFrom && num > 0.0;
		countdown.Text = (flag ? $"{Math.Ceiling(num):0}s" : "");
		countdownHost.Opacity = (flag ? (hintOpacity * Math.Min(1.0, Math.Max(0.0, num / 5.0))) : 0.0);
	}

	public void DismissVideo()
	{
		if ((object)player != null)
		{
			Log.Info("video", "dismissed");
			FinishVideo();
		}
	}

	public void SkipVideo()
	{
		if (IsVideoOnScreen)
		{
			Log.Info("video", "skipped (double Escape)");
			ClickyAnalytics.TrackOnboardingSkippedByShake();
			FinishVideo();
		}
	}

	internal void SeekNearEnd(double secondsBeforeEnd)
	{
		MediaPlayer mediaPlayer = player;
		if ((object)mediaPlayer != null)
		{
			MediaPlaybackSession playbackSession = mediaPlayer.PlaybackSession;
			if (!(playbackSession.NaturalDuration.TotalSeconds <= secondsBeforeEnd))
			{
				playbackSession.Position = playbackSession.NaturalDuration - TimeSpan.FromSeconds(secondsBeforeEnd);
			}
		}
	}

	private void FinishVideo()
	{
		MediaPlayer mp = player;
		if ((object)mp == null)
		{
			return;
		}
		videoTimer?.Stop();
		countdownHost.Opacity = 0.0;
		Anim.Opacity(videoCard, 0f, 2.0, Easing.EaseInOut(Ui.Compositor));
		Action? action = videoEnded;
		videoEnded = null;
		After(2.0, () =>
		{
			if (player == mp)
			{
				StopVideo();
			}
		});
		action?.Invoke();
	}

	private void StopVideo()
	{
		videoTimer?.Stop();
		while (videoCard.Children.Count > 1)
		{
			RemoveVideoView();
		}
		MediaPlayer mediaPlayer = player;
		if ((object)mediaPlayer != null)
		{
			player = null;
			try
			{
				mediaPlayer.Pause();
				mediaPlayer.Dispose();
			}
			catch
			{
			}
		}
		HideIfEmpty();
	}

	private void RemoveVideoView()
	{
		UIElementCollection children = videoCard.Children;
		if (children[children.Count - 1] is RoundedVideoView roundedVideoView)
		{
			roundedVideoView.Attach(null);
		}
		videoCard.Children.RemoveAt(videoCard.Children.Count - 1);
	}

	private void EscapeWatch()
	{
		bool flag = (Native.GetAsyncKeyState(27) & 0x8000) != 0;
		if (flag && !escapeWasDown)
		{
			OnEscapePressed();
		}
		escapeWasDown = flag;
	}

	internal void OnEscapePressed()
	{
		long tickCount = Environment.TickCount64;
		if (firstEscapeAt != 0L && tickCount - firstEscapeAt <= 2000)
		{
			firstEscapeAt = 0L;
			if (IsVideoOnScreen)
			{
				if (onboardingAnalytics)
				{
					ClickyAnalytics.TrackOnboardingVideoEscapePressed("confirmed_skip", VideoRemainingSeconds);
				}
				SkipVideo();
			}
			else if ((object)player == null)
			{
				DoubleEscape?.Invoke();
			}
		}
		else
		{
			firstEscapeAt = tickCount;
			if (IsVideoOnScreen && onboardingAnalytics)
			{
				ClickyAnalytics.TrackOnboardingVideoEscapePressed("armed_skip", VideoRemainingSeconds);
			}
		}
	}

	public void WatchEscape(bool on)
	{
		if (on && !frame.IsRunning)
		{
			frame.Start();
		}
		else if (!on && !visible)
		{
			frame.Stop();
		}
	}

	private void After(double seconds, Action a)
	{
		DispatcherQueueTimer t = dq.CreateTimer().Rooted();
		t.Interval = TimeSpan.FromSeconds(Math.Max(0.001, seconds));
		t.IsRepeating = false;
		pending.Add(t);
		t.Tick += (DispatcherQueueTimer _, object _) =>
		{
			pending.Remove(t);
			a();
		};
		t.Start();
	}
}
