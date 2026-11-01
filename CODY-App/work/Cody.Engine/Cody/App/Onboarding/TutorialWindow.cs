using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Numerics;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using HeyClicky.App.Design;
using HeyClicky.App.Interop;
using HeyClicky.App.Notch.Surfaces;
using HeyClicky.App.Services;
using HeyClicky.App.Shell;
using HeyClicky.App.UI;
using HeyClicky.Core.Onboarding;
using HeyClicky.Core.Telemetry;
using HeyClicky.Core.Voice;
using HeyClicky.Platform.Audio;
using Microsoft.UI;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.Devices.Enumeration;
using Windows.Media.Core;
using Windows.Media.Playback;
using Windows.UI;

namespace HeyClicky.App.Onboarding;

public sealed class TutorialWindow
{
	public enum Step
	{
		MicCheck,
		SpeakerCheck,
		VoiceHello,
		ClickyInterview,
		DrawDemo,
		DrawToAsk,
		ClickyDrive,
		TextMode,
		Finale
	}

	private readonly AppServices s;

	private readonly IAppActions actions;

	private readonly PanelWindow window;

	private readonly DispatcherQueue dq;

	private readonly Grid card = new Grid();

	private readonly Grid stage = new Grid();

	private readonly ContentControl dotsSlot = new ContentControl
	{
		HorizontalContentAlignment = HorizontalAlignment.Center,
		IsTabStop = false
	};

	private readonly Grid footer = new Grid();

	private readonly Pressable back;

	private readonly Pressable music;

	private readonly Pressable skip;

	private readonly HashSet<Step> completed = new HashSet<Step>();

	private readonly DispatcherQueueTimer poll;

	private Step step;

	private int furthest;

	private bool showSpeakerCheck;

	private bool musicMuted;

	private GelButton? continueButton;

	private MicMeter? meter;

	private readonly List<KeyCap> liveCaps = new List<KeyCap>();

	private double loudSeconds;

	private VoiceState lastVoice;

	private FrameworkElement? statusLine;

	private static readonly SwiftSpring PageSpring = new SwiftSpring(0.38, 0.86);

	private const double PanelWidth = 500.0;

	private const double InterviewPanelWidth = 760.0;

	private const double StageHeight = 416.0;

	private const double InterviewStageHeight = 440.0;

	private const double PanelChromeHeight = 156.0;

	private long? startedAt;

	private bool bringingForward;

	private bool interviewHooked;

	private bool shown;

	private bool vmHooked;

	private bool composerClosingForCountdown;

	private bool typedTurnInFlight;

	private bool revealRunning;

	private int volumeTicks;

	private double? systemVolume;

	private bool volumeReadInFlight;

	private bool composerSeen;

	private NotchPresentation? lastPresentation;

	private readonly HashSet<DispatcherQueueTimer> pendingTimers = new HashSet<DispatcherQueueTimer>();

	public const double DrawStepClearLeadSeconds = 0.7;

	public const double DrawStepLastLineMinimumSeconds = 2.5;

	private CancellationTokenSource? drawStepStage;

	private bool popContinueOnRender;

	private GelButton? finaleShowMe;

	public Step CurrentStep => step;

	public PanelWindow Window => window;

	public OnboardingTutorialViewModel? Vm { get; init; }

	private Color Theme => DS.CursorColor(s.Settings.CursorColorHex);

	private int? DurationSeconds
	{
		get
		{
			long? num = startedAt;
			if (num.HasValue)
			{
				long valueOrDefault = num.GetValueOrDefault();
				return (int)((Environment.TickCount64 - valueOrDefault) / 1000);
			}
			return null;
		}
	}

	private IEnumerable<Step> VisibleSteps => Enum.GetValues<Step>().Where((Step x) =>
	{
		bool flag = x != Step.SpeakerCheck || showSpeakerCheck;
		if (flag)
		{
			bool flag2 = Vm?.SkipsDrawingSteps ?? false;
			if (flag2)
			{
				bool flag3 = (uint)(x - 4) <= 1u;
				flag2 = flag3;
			}
			flag = !flag2;
		}
		return flag;
	});

	private Step? Previous
	{
		get
		{
			List<Step> list = VisibleSteps.ToList();
			int num = list.IndexOf(step);
			if (num <= 0)
			{
				return null;
			}
			return list[num - 1];
		}
	}

	private Step? Next
	{
		get
		{
			List<Step> list = VisibleSteps.ToList();
			int num = list.IndexOf(step);
			if (num < 0 || num + 1 >= list.Count)
			{
				return null;
			}
			return list[num + 1];
		}
	}

	public bool IsRunning
	{
		get
		{
			if (shown)
			{
				return !revealRunning;
			}
			return false;
		}
	}

	public bool IsShown => shown;

	public bool IsBuried
	{
		get
		{
			if (shown)
			{
				return Native.GetForegroundWindow() != window.Hwnd;
			}
			return false;
		}
	}

	public Action? StopVoiceAndMarks { get; init; }

	public Action<Step?>? StepChanged { get; init; }

	public Func<bool>? DrawingShown { get; init; }

	public Func<string?>? MicrophoneName { get; init; }

	public Action<string?, string>? MicrophonePicked { get; init; }

	public nint HwndForTests => window.Hwnd;

	public IReadOnlyList<Step> VisibleStepsForTests => VisibleSteps.ToList();

	public Func<bool>? CanReveal { get; init; }

	public Func<Task>? RunReveal { get; init; }

	public Func<bool>? CanDrawFinale { get; init; }

	public Func<Task>? RunDrawnFinale { get; init; }

	public IScreenDrawingCanvas? Canvas { get; init; }

	public Action<bool>? Music { get; init; }

	public InterviewController? Interview { get; init; }

	public bool IsDrawStepStageRunning => drawStepStage != null;

	public bool IsOnDriveStep
	{
		get
		{
			if (shown && !revealRunning)
			{
				return step == Step.ClickyDrive;
			}
			return false;
		}
	}

	public bool IsDriveDemoDriving
	{
		get
		{
			if (shown && step == Step.ClickyDrive)
			{
				return TourDrive.IsDriving?.Invoke() ?? false;
			}
			return false;
		}
	}

	public event Action? Ended;

	private static OnboardingTutorialStep Map(Step st)
	{
		return Enum.Parse<OnboardingTutorialStep>(st.ToString());
	}

	public TutorialWindow(AppServices services, IAppActions actions, bool excludeFromCapture)
	{
		s = services;
		this.actions = actions;
		dq = DispatcherQueue.GetForCurrentThread();
		window = new PanelWindow("HeyClicky tour", excludeFromCapture, showInTaskbar: true);
		Grid grid = new Grid
		{
			Margin = new Thickness(24.0)
		};
		grid.RowDefinitions.Add(new RowDefinition
		{
			Height = GridLength.Auto
		});
		grid.RowDefinitions.Add(new RowDefinition
		{
			Height = GridLength.Auto
		});
		grid.RowDefinitions.Add(new RowDefinition
		{
			Height = GridLength.Auto
		});
		dotsSlot.Margin = new Thickness(0.0, 8.0, 0.0, 20.0);
		Grid.SetRow(stage, 1);
		Grid.SetRow(footer, 2);
		footer.Margin = new Thickness(0.0, 22.0, 0.0, 0.0);
		footer.Height = 42.0;
		grid.Children.Add(dotsSlot);
		grid.Children.Add(stage);
		grid.Children.Add(footer);
		card.Children.Add(grid);
		back = ChromeButton(Ui.H(3.0, Bold(Icons.Glyph("\ue76b", 10.0, DS.Colors.TextSecondary)), Ui.Medium("Back", 12.0, DS.Colors.TextSecondary)), new Thickness(4.0, 6.0, 4.0, 6.0));
		back.Click += Back;
		music = ChromeButton(Ui.Medium("♫", 13.0, DS.Colors.TextSecondary).Size(18.0, 0.0), new Thickness(4.0));
		music.Click += ToggleMusic;
		skip = ChromeButton(Ui.Medium("Skip demo", 12.0, DS.Colors.TextSecondary), new Thickness(6.0, 4.0, 6.0, 4.0));
		skip.Click += () =>
		{
			End("skipped");
		};
		StackPanel stackPanel = Ui.H(0.0, music, skip);
		stackPanel.HorizontalAlignment = HorizontalAlignment.Right;
		back.HorizontalAlignment = HorizontalAlignment.Left;
		Grid item = new Grid
		{
			Margin = new Thickness(16.0, 24.0, 16.0, 0.0),
			VerticalAlignment = VerticalAlignment.Top,
			Children = 
			{
				(UIElement)back,
				(UIElement)stackPanel
			}
		};
		card.Children.Add(item);
		window.Panel.Children.Add(card);
		window.UseFixedEnvelope(760.0, 596.0);
		window.ShownSizeChanged += (double _, double h) =>
		{
			stage.Height = Math.Max(0.0, h - 156.0);
		};
		poll = dq.CreateTimer();
		poll.Interval = TimeSpan.FromMilliseconds(33L, 0L);
		poll.Tick += (DispatcherQueueTimer _, object _) =>
		{
			Tick();
		};
		s.Companion.StateChanged += (object? _, EventArgs _) =>
		{
			dq.TryEnqueue(OnVoiceState);
		};
		s.Presenter.PresentationChanged += (object? _, EventArgs _) =>
		{
			dq.TryEnqueue(OnPresentation);
		};
	}

	private static TextBlock Bold(TextBlock t)
	{
		t.FontWeight = FontWeights.SemiBold;
		return t;
	}

	public static string AnalyticsName(Step st)
	{
		return st switch
		{
			Step.MicCheck => "mic_check", 
			Step.SpeakerCheck => "speaker_check", 
			Step.VoiceHello => "voice_hello", 
			Step.ClickyInterview => "clicky_interview", 
			Step.DrawDemo => "draw_demo", 
			Step.DrawToAsk => "draw_to_ask", 
			Step.ClickyDrive => "clicky_drive", 
			Step.TextMode => "text_mode", 
			_ => "finale", 
		};
	}

	private void TrackResolved(string outcome, Step lastStep)
	{
		ClickyAnalytics.TrackOnboardingTutorialResolved(outcome, AnalyticsName(lastStep), DurationSeconds);
		startedAt = null;
	}

	internal void Back()
	{
		Step? previous = Previous;
		if (previous.HasValue)
		{
			Step valueOrDefault = previous.GetValueOrDefault();
			Go(valueOrDefault, "back");
		}
	}

	internal void ToggleMusic()
	{
		musicMuted = !musicMuted;
		Music?.Invoke(!musicMuted);
		ClickyAnalytics.TrackOnboardingTutorialMusicToggled(musicMuted);
		RenderChrome();
	}

	private static Pressable ChromeButton(FrameworkElement content, Thickness padding)
	{
		Pressable pressable = new Pressable();
		pressable.Padding = padding;
		pressable.Children.Add(content);
		pressable.WithPressScale();
		return pressable;
	}

	public void Show(Step at = Step.MicCheck, bool includeSpeakerCheck = false)
	{
		OnboardingTutorialViewModel vm = Vm;
		if (vm == null || vm.IsEngaged)
		{
			OnboardingTutorialViewModel? vm2 = Vm;
			if (vm2 == null || vm2.Phase != OnboardingTutorialPhase.InvitePresented)
			{
				goto IL_0048;
			}
		}
		Vm.StartFromInvite();
		if (at != Step.MicCheck)
		{
			Vm.BeginAt(Map(at));
		}
		goto IL_0048;
		IL_0048:
		HookVm();
		if (!bringingForward)
		{
			CancelDrawStepStage(bringPanelBack: false);
		}
		showSpeakerCheck = includeSpeakerCheck || at == Step.SpeakerCheck;
		if (!interviewHooked)
		{
			InterviewController interview = Interview;
			if (interview != null)
			{
				interviewHooked = true;
				interview.Completed += () =>
				{
					dq.TryEnqueue(OnInterviewCompleted);
				};
				interview.IsOnInterviewStep = () => shown && !revealRunning && this.step == Step.ClickyInterview;
			}
		}
		Step step = (shown ? this.step : ((Step)(-1)));
		shown = true;
		this.step = at;
		if (!bringingForward)
		{
			startedAt = Environment.TickCount64;
			if (at == Step.MicCheck)
			{
				ClickyAnalytics.TrackOnboardingTutorialStarted();
			}
			ClickyAnalytics.TrackOnboardingTutorialStepViewed(AnalyticsName(at), (at == Step.MicCheck) ? "start" : "debug_jump");
		}
		InterviewStepChanged(step, at);
		StepChanged?.Invoke(at);
		furthest = Math.Max(furthest, VisibleSteps.ToList().IndexOf(at));
		Render(animated: false);
		window.ShowCentered();
		Sounds.Play("clicky-text-open", 0.35);
		card.Opacity = 0.0;
		card.Translation = new Vector3(0f, 10f, 0f);
		card.Scale = new Vector3(0.985f, 0.985f, 1f);
		card.CenterPoint = new Vector3((float)window.PanelWidth / 2f, (float)window.PanelHeight / 2f, 0f);
		SwiftSpring spring = new SwiftSpring(0.4, 0.86);
		Anim.OpacitySpring(card, 1f, spring);
		Anim.TranslationSpring(card, Vector3.Zero, spring);
		Anim.ScaleSpring(card, 1f, spring);
		poll.Start();
	}

	public void Hide()
	{
		poll.Stop();
		shown = false;
		if (step == Step.MicCheck)
		{
			StopMicLevelMonitor();
		}
		window.HideWindow();
	}

	private void StopMicLevelMonitor()
	{
		if (s.Companion.State != VoiceState.Listening)
		{
			s.Microphone.Stop();
		}
	}

	public void BringForward()
	{
		if (!shown)
		{
			bringingForward = true;
			try
			{
				Show(step);
				return;
			}
			finally
			{
				bringingForward = false;
			}
		}
		window.ShowActivated();
	}

	public void Go(Step next, string navigation = "jump")
	{
		OnboardingTutorialViewModel vm = Vm;
		if (vm != null)
		{
			OnboardingTutorialStep onboardingTutorialStep = Map(next);
			if (vm.CurrentStep != onboardingTutorialStep)
			{
				vm.JumpTo(onboardingTutorialStep);
			}
		}
		Step step = this.step;
		this.step = next;
		ClickyAnalytics.TrackOnboardingTutorialStepViewed(AnalyticsName(next), navigation);
		if (step == Step.MicCheck && next != Step.MicCheck)
		{
			StopMicLevelMonitor();
		}
		DrawingStepChanged(step, next);
		InterviewStepChanged(step, next);
		StepChanged?.Invoke(next);
		furthest = Math.Max(furthest, VisibleSteps.ToList().IndexOf(next));
		Render(animated: true);
	}

	internal void Advance()
	{
		if (step == Step.MicCheck)
		{
			double num = systemVolume ?? SystemVolume.EffectiveLevel();
			showSpeakerCheck = showSpeakerCheck || num <= 0.02;
		}
		if (step == Step.MicCheck && !musicMuted)
		{
			Music?.Invoke(obj: true);
		}
		Vm?.Advance();
		Step? next = Next;
		if (next.HasValue)
		{
			Step valueOrDefault = next.GetValueOrDefault();
			Go(valueOrDefault, "advance");
		}
		else
		{
			End("finished");
		}
	}

	internal void End(string reason)
	{
		if (step == Step.ClickyInterview)
		{
			Interview?.Stop();
		}
		Interview?.CancelPreparedOpening();
		CancelDrawStepStage(bringPanelBack: false);
		CancelDriveDemo();
		if (reason != "finished" || s.Companion.State != VoiceState.Idle)
		{
			Log.Info("tutorial", $"ended ({reason}) on {step}: voice stopped, marks cleared");
			StopVoiceAndMarks?.Invoke();
		}
		composerClosingForCountdown = false;
		Hide();
		OnboardingTutorialViewModel vm = Vm;
		if (vm != null)
		{
			vm.End(reason);
		}
		else
		{
			s.Settings.HasCompletedTutorial = true;
		}
		TrackResolved(reason, step);
		StepChanged?.Invoke(null);
		Ended?.Invoke();
	}

	private void HookVm()
	{
		if (vmHooked)
		{
			return;
		}
		OnboardingTutorialViewModel vm = Vm;
		if (vm == null)
		{
			return;
		}
		vmHooked = true;
		TextInputSurface.Typing += () =>
		{
			if (step == Step.TextMode && shown)
			{
				vm.NoteTextComposerTyping();
			}
		};
		vm.PropertyChanged += (object? _, PropertyChangedEventArgs e) =>
		{
			if (e.PropertyName == "CurrentStep")
			{
				dq.TryEnqueue(FollowVmStep);
			}
			else if (e.PropertyName == "IsCurrentStepCompleted")
			{
				dq.TryEnqueue(() =>
				{
					if (vm.IsCurrentStepCompleted)
					{
						OnboardingTutorialStep? currentStep = vm.CurrentStep;
						if (currentStep.HasValue)
						{
							OnboardingTutorialStep valueOrDefault = currentStep.GetValueOrDefault();
							if (Map(step) == valueOrDefault)
							{
								Complete(step, autoAdvance: false);
							}
						}
					}
				});
			}
		};
		vm.CloseComposerRequested += (object? _, EventArgs _) =>
		{
			dq.TryEnqueue(() =>
			{
				if (s.Presenter.Presentation is NotchPresentation.TextInput)
				{
					composerClosingForCountdown = true;
					s.Presenter.Present(new NotchPresentation.Idle());
				}
			});
		};
	}

	private void FollowVmStep()
	{
		OnboardingTutorialStep? onboardingTutorialStep = Vm?.CurrentStep;
		if (!onboardingTutorialStep.HasValue)
		{
			return;
		}
		OnboardingTutorialStep valueOrDefault = onboardingTutorialStep.GetValueOrDefault();
		if (!shown || revealRunning || Map(step) == valueOrDefault || !Enum.TryParse<Step>(valueOrDefault.ToString(), out var result))
		{
			return;
		}
		if (result == Step.SpeakerCheck)
		{
			showSpeakerCheck = true;
		}
		if (VisibleSteps.Contains(result))
		{
			if (step == Step.MicCheck && result != Step.MicCheck && !musicMuted)
			{
				Music?.Invoke(obj: true);
			}
			Go(result);
		}
	}

	private void Complete(Step which, bool autoAdvance)
	{
		if (!completed.Add(which))
		{
			return;
		}
		if (which == Step.DrawDemo)
		{
			popContinueOnRender = true;
		}
		ClickyAnalytics.TrackOnboardingTutorialStepCompleted(AnalyticsName(which));
		if (which == Step.MicCheck)
		{
			Vm?.NoteMicHeardSustainedInput();
		}
		if (which == step)
		{
			RenderFooter();
		}
		if (!autoAdvance)
		{
			return;
		}
		After(1.6, () =>
		{
			if (step == which)
			{
				Advance();
			}
		});
	}

	private void Render(bool animated)
	{
		bool flag = step == Step.ClickyInterview;
		double num = (flag ? 760.0 : 500.0);
		double height = 156.0 + (flag ? 440.0 : 416.0);
		if (animated)
		{
			window.AnimatePanelSize(num, height, PageSpring);
		}
		else
		{
			window.SetPanelSize(num, height);
		}
		List<Step> list = VisibleSteps.ToList();
		dotsSlot.Content = new ProgressDots(list.Count, list.IndexOf(step), (int i) =>
		{
			Go(list[i]);
		}, furthest);
		RenderChrome();
		object obj;
		if (stage.Children.Count <= 0)
		{
			obj = null;
		}
		else
		{
			UIElementCollection children = stage.Children;
			obj = (FrameworkElement)children[children.Count - 1];
		}
		FrameworkElement old = (FrameworkElement)obj;
		liveCaps.Clear();
		meter = null;
		statusLine = null;
		FrameworkElement frameworkElement = Page();
		frameworkElement.Margin = new Thickness(0.0, 24.0, 0.0, 0.0);
		frameworkElement.VerticalAlignment = VerticalAlignment.Stretch;
		stage.Children.Add(frameworkElement);
		if ((object)old != null)
		{
			if (animated)
			{
				Anim.OpacitySpring(old, 0f, PageSpring);
				Anim.TranslationSpring(old, new Vector3(0f, -6f, 0f), PageSpring);
				After(0.4, () =>
				{
					stage.Children.Remove(old);
				});
				frameworkElement.Opacity = 0.0;
				frameworkElement.Translation = new Vector3(0f, 10f, 0f);
				frameworkElement.Scale = new Vector3(0.985f, 0.985f, 1f);
				frameworkElement.CenterPoint = new Vector3((float)num / 2f - 24f, 200f, 0f);
				Anim.OpacitySpring(frameworkElement, 1f, PageSpring);
				Anim.TranslationSpring(frameworkElement, Vector3.Zero, PageSpring);
				Anim.ScaleSpring(frameworkElement, 1f, PageSpring);
			}
			else
			{
				stage.Children.Remove(old);
			}
		}
		RenderFooter();
		if (step == Step.Finale)
		{
			skip.Visibility = Visibility.Collapsed;
		}
		else
		{
			skip.Visibility = Visibility.Visible;
		}
	}

	private void RenderChrome()
	{
		back.Visibility = ((!Previous.HasValue) ? Visibility.Collapsed : Visibility.Visible);
		music.Visibility = ((furthest <= 0) ? Visibility.Collapsed : Visibility.Visible);
		music.Children.Clear();
		TextBlock item = Ui.Medium("♫", 13.0, DS.Colors.TextSecondary).Size(18.0, 0.0);
		Grid grid = new Grid
		{
			Children = { (UIElement)item }
		};
		if (musicMuted)
		{
			grid.Children.Add(new Rectangle
			{
				Width = 1.5,
				Height = 15.0,
				Fill = Ui.Brush(DS.Colors.TextSecondary),
				RenderTransform = new RotateTransform
				{
					Angle = -45.0,
					CenterX = 0.75,
					CenterY = 7.5
				},
				HorizontalAlignment = HorizontalAlignment.Center,
				VerticalAlignment = VerticalAlignment.Center
			});
		}
		music.Children.Add(grid);
		AutomationProperties.SetName(music, musicMuted ? "Turn tour music on" : "Turn tour music off");
	}

	private void RenderFooter()
	{
		footer.Children.Clear();
		if (step == Step.Finale)
		{
			return;
		}
		continueButton = new GelButton("Continue", GelAppearance.PrimaryBlue, GelButton.Sizing.Large, 100.0)
		{
			HorizontalAlignment = HorizontalAlignment.Center
		};
		bool flag = completed.Contains(step);
		continueButton.IsEnabledGel = flag;
		if (flag && step == Step.DrawDemo && popContinueOnRender)
		{
			popContinueOnRender = false;
			PopContinue(continueButton);
		}
		if (step == Step.ClickyInterview && !flag)
		{
			continueButton.Opacity = 0.0;
		}
		continueButton.Click += () =>
		{
			Log.Info("tutorial", $"Continue clicked on {step} (completed: {completed.Contains(step)})");
			if (completed.Contains(step))
			{
				Advance();
			}
		};
		footer.Children.Add(continueButton);
	}

	private FrameworkElement Layout(string title, string body, FrameworkElement interactive)
	{
		TextBlock item = Ui.Text(title, 20.0, FontWeights.SemiBold, DS.Colors.TextPrimary, TextAlignment.Center, 0, wrap: true);
		TextBlock textBlock = Ui.Text(body, 13.0, FontWeights.Medium, DS.Colors.TextSecondary, TextAlignment.Center, 0, wrap: true);
		textBlock.LineHeight = 19.29;
		textBlock.LineStackingStrategy = LineStackingStrategy.BlockLineHeight;
		StackPanel item2 = new StackPanel
		{
			Spacing = 8.0,
			MaxWidth = 360.0,
			HorizontalAlignment = HorizontalAlignment.Center,
			Children = 
			{
				(UIElement)item,
				(UIElement)textBlock
			}
		};
		interactive.MaxWidth = Math.Max((interactive.MaxWidth == double.PositiveInfinity) ? 360.0 : interactive.MaxWidth, 360.0);
		interactive.HorizontalAlignment = HorizontalAlignment.Center;
		interactive.VerticalAlignment = VerticalAlignment.Center;
		Grid grid = new Grid
		{
			RowDefinitions = 
			{
				new RowDefinition
				{
					Height = GridLength.Auto
				},
				new RowDefinition
				{
					Height = new GridLength(1.0, GridUnitType.Star)
				}
			}
		};
		StepInteractiveSlot stepInteractiveSlot = new StepInteractiveSlot(interactive)
		{
			Margin = new Thickness(0.0, 18.0, 0.0, 18.0)
		};
		Grid.SetRow(stepInteractiveSlot, 1);
		grid.Children.Add(item2);
		grid.Children.Add(stepInteractiveSlot);
		return grid;
	}

	private FrameworkElement Page()
	{
		return step switch
		{
			Step.MicCheck => MicCheckPage(), 
			Step.SpeakerCheck => SpeakerPage(), 
			Step.VoiceHello => VoicePage("This is how you talk to me", "Hold the keys down, say hi or tell me your name, then let go. I'm listening the whole time you hold them.", "My name is " + FirstName(), stagger: false), 
			Step.ClickyInterview => InterviewPage(), 
			Step.DrawDemo => VoicePage("Here's how I'd help you", "I see what you see. Hold the keys, ask, and watch your screen.", "Show me how you'd help me", stagger: true), 
			Step.DrawToAsk => DrawToAskPage(), 
			Step.ClickyDrive => ClickyDrivePage(), 
			Step.TextMode => TextModePage(), 
			_ => FinalePage(), 
		};
	}

	private string FirstName()
	{
		string text = s.Auth.User?.DisplayName;
		if (!string.IsNullOrWhiteSpace(text))
		{
			return text.Trim().Split(' ')[0];
		}
		string userName = Environment.UserName;
		if (!string.IsNullOrWhiteSpace(userName))
		{
			ReadOnlySpan<char> readOnlySpan = new ReadOnlySpan<char>(char.ToUpperInvariant(userName[0]));
			string text2 = userName;
			return string.Concat(readOnlySpan, text2.Substring(1, text2.Length - 1));
		}
		return "[your name]";
	}

	private FrameworkElement MicCheckPage()
	{
		meter = new MicMeter(Theme);
		FrameworkElement frameworkElement = MicPicker();
		StackPanel interactive = new StackPanel
		{
			Spacing = 16.0,
			Children = 
			{
				(UIElement)meter,
				(UIElement)new SpokenBubble("Testing, testing, 1, 2, 3"),
				(UIElement)frameworkElement
			}
		};
		frameworkElement.HorizontalAlignment = HorizontalAlignment.Center;
		s.Microphone.Start();
		return Layout("First, can I hear you?", "Say anything out loud. If the bars dance, your mic works. I hear best on built-in or wired mics: Bluetooth ones get flaky.", interactive);
	}

	private FrameworkElement MicPicker()
	{
		Pressable p = new Pressable
		{
			Height = 38.0,
			Padding = new Thickness(16.0, 0.0, 16.0, 0.0),
			CornerRadius = new CornerRadius(10.0),
			Background = Ui.Brush(DS.White(0.06)),
			BorderBrush = Ui.Brush(DS.White(0.22)),
			BorderThickness = new Thickness(1.0)
		};
		TextBlock textBlock = Bold(Icons.Glyph("\ue720", 12.0, DS.Colors.TextSecondary));
		TextBlock name = Ui.Semibold(MicrophoneName?.Invoke() ?? "System Default", 13.0, DS.Colors.TextPrimary);
		TextBlock textBlock2 = Bold(Icons.Glyph("\ue8cb", 10.0, DS.Colors.TextSecondary));
		textBlock2.Margin = new Thickness(2.0, 0.0, 0.0, 0.0);
		p.Children.Add(Ui.H(8.0, textBlock, name, textBlock2).Center());
		MenuFlyout menu = new MenuFlyout();
		Add("System Default", null, name.Text == "System Default");
		p.Click += async () =>
		{
			try
			{
				DeviceInformationCollection source = await DeviceInformation.FindAllAsync(DeviceClass.AudioCapture);
				while (menu.Items.Count > 1)
				{
					menu.Items.RemoveAt(1);
				}
				foreach (DeviceInformation item in source.OrderBy((DeviceInformation d) => d.Name))
				{
					Add(item.Name, EndpointId(item.Id), item.Name == name.Text);
				}
			}
			catch
			{
			}
			menu.ShowAt(p);
		};
		return p;
		void Add(string label, string? id, bool check)
		{
			ToggleMenuFlyoutItem toggleMenuFlyoutItem = new ToggleMenuFlyoutItem
			{
				Text = label,
				IsChecked = check
			};
			toggleMenuFlyoutItem.Click += (object _, RoutedEventArgs _) =>
			{
				if (name.Text != label)
				{
					ClickyAnalytics.TrackOnboardingTutorialMicDeviceSwitched();
				}
				name.Text = label;
				MicrophonePicked?.Invoke(id, label);
			};
			menu.Items.Add(toggleMenuFlyoutItem);
		}
	}

	private static string? EndpointId(string interfaceId)
	{
		Match match = Regex.Match(interfaceId, "MMDEVAPI#(\\{[^#]+)#", RegexOptions.IgnoreCase);
		if (!match.Success)
		{
			return null;
		}
		return match.Groups[1].Value;
	}

	private FrameworkElement SpeakerPage()
	{
		bool flag = completed.Contains(Step.SpeakerCheck);
		TextBlock textBlock = Icons.Glyph(flag ? "\ue767" : "\ue74f", 30.0, flag ? Theme : DS.Colors.TextSecondary);
		textBlock.Height = 40.0;
		Pressable pressable = new Pressable
		{
			CornerRadius = new CornerRadius(100.0),
			Background = Ui.Brush(Theme),
			Padding = new Thickness(24.0, 10.0, 24.0, 10.0),
			HorizontalAlignment = HorizontalAlignment.Center
		};
		pressable.Children.Add(Ui.Semibold("Set volume to 50%", 13.0, Colors.White));
		pressable.WithPressScale();
		pressable.Click += () =>
		{
			SystemVolume.SetLevel(0.5);
			ClickyAnalytics.TrackOnboardingTutorialSpeakerVolumeFixed("button");
			Complete(Step.SpeakerCheck, autoAdvance: true);
			Render(animated: false);
		};
		return Layout("Your volume is at zero", "You'd see me talking and hear nothing. One click fixes it before we start.", new StackPanel
		{
			Spacing = 18.0,
			Children = 
			{
				(UIElement)textBlock,
				(UIElement)pressable
			}
		});
	}

	private FrameworkElement KeyRow(string lead, string trail, KeyCap.Size size, double labelWidth, double spacing, double fontSize)
	{
		StackPanel stackPanel = new StackPanel
		{
			Orientation = Orientation.Horizontal,
			Spacing = spacing,
			HorizontalAlignment = HorizontalAlignment.Center
		};
		TextBlock textBlock = Ui.Medium(lead, fontSize, DS.Colors.TextSecondary);
		textBlock.VerticalAlignment = VerticalAlignment.Center;
		if (labelWidth > 0.0)
		{
			textBlock.Width = labelWidth;
			textBlock.TextAlignment = TextAlignment.Right;
		}
		stackPanel.Children.Add(textBlock);
		KeyCap keyCap = new KeyCap("Ctrl", "control", size, Theme);
		KeyCap keyCap2 = new KeyCap("Alt", "alt", size, Theme);
		liveCaps.Add(keyCap);
		liveCaps.Add(keyCap2);
		stackPanel.Children.Add(Ui.H(spacing, keyCap, keyCap2));
		if (!string.IsNullOrEmpty(trail))
		{
			TextBlock textBlock2 = Ui.Medium(trail, fontSize, DS.Colors.TextSecondary);
			textBlock2.VerticalAlignment = VerticalAlignment.Center;
			if (labelWidth > 0.0)
			{
				textBlock2.Width = labelWidth;
			}
			stackPanel.Children.Add(textBlock2);
		}
		return stackPanel;
	}

	private FrameworkElement VoicePage(string title, string body, string line, bool stagger)
	{
		FrameworkElement frameworkElement = KeyRow("Hold", "and say", KeyCap.Size.Regular, 56.0, 10.0, 12.5);
		SpokenBubble spokenBubble = new SpokenBubble(line);
		if (stagger)
		{
			Reveal(frameworkElement, 0.5);
			Reveal(spokenBubble, 0.85);
		}
		Grid item = (Grid)(statusLine = new Grid
		{
			Height = 16.0
		});
		UpdateStatus();
		return Layout(title, body, new StackPanel
		{
			Spacing = 14.0,
			Children = 
			{
				(UIElement)new StackPanel
				{
					Spacing = 10.0,
					Children = 
					{
						(UIElement)frameworkElement,
						(UIElement)spokenBubble
					}
				},
				(UIElement)item
			}
		});
	}

	private void Reveal(FrameworkElement e, double delay)
	{
		if (!Anim.Instant)
		{
			e.Opacity = 0.0;
			e.Translation = new Vector3(0f, 8f, 0f);
			e.Scale = new Vector3(0.97f, 0.97f, 1f);
			After(delay, () =>
			{
				SwiftSpring spring = new SwiftSpring(0.45, 0.85);
				Anim.OpacitySpring(e, 1f, spring);
				Anim.TranslationSpring(e, Vector3.Zero, spring);
				Anim.ScaleSpring(e, 1f, spring);
			});
		}
	}

	private void UpdateStatus()
	{
		if (!(statusLine is Grid grid))
		{
			return;
		}
		grid.Children.Clear();
		if (!completed.Contains(step))
		{
			string text = s.Companion.State switch
			{
				VoiceState.Listening => "listening…", 
				VoiceState.Processing => "thinking…", 
				VoiceState.Responding => "speaking…", 
				_ => (step == Step.DrawToAsk) ? null : "waiting for you…", 
			};
			if (text != null)
			{
				grid.Children.Add(Ui.Text(text, 11.5, FontWeights.Medium, DS.Colors.TextSecondary, TextAlignment.Center));
			}
		}
	}

	private FrameworkElement DrawToAskPage()
	{
		Grid grid = new Grid
		{
			Width = 320.0,
			Height = 195.0,
			HorizontalAlignment = HorizontalAlignment.Center
		};
		string text = System.IO.Path.Combine(AppContext.BaseDirectory, "Assets", "Video", "clicky-spatial-demo.mp4");
		if (File.Exists(text))
		{
			RoundedVideoView view = new RoundedVideoView(320.0, 195.0, 12.0);
			MediaPlayer mp = new MediaPlayer
			{
				Source = MediaSource.CreateFromUri(new Uri(text)),
				IsLoopingEnabled = true,
				IsMuted = true,
				AutoPlay = false
			};
			view.Attach(mp);
			view.Loaded += (object _, RoutedEventArgs _) =>
			{
				mp.Play();
			};
			view.Unloaded += (object _, RoutedEventArgs _) =>
			{
				view.Attach(null);
				try
				{
					mp.Pause();
					mp.Dispose();
				}
				catch
				{
				}
			};
			grid.Children.Add(view);
		}
		else
		{
			Border item = new Border
			{
				Background = Ui.Brush(DS.White(0.06))
			};
			grid.Children.Add(item);
			Ui.ClipRounded(grid, 12.0);
		}
		grid.Children.Add(new Border
		{
			CornerRadius = new CornerRadius(12.0),
			BorderBrush = Ui.Brush(DS.White(0.14)),
			BorderThickness = new Thickness(0.5),
			IsHitTestVisible = false
		});
		StackPanel stackPanel = new StackPanel
		{
			Orientation = Orientation.Horizontal,
			Spacing = 7.0,
			HorizontalAlignment = HorizontalAlignment.Center
		};
		TextBlock textBlock = Ui.Medium("Hold", 11.5, DS.Colors.TextSecondary);
		textBlock.VerticalAlignment = VerticalAlignment.Center;
		KeyCap keyCap = new KeyCap("Ctrl", "control", KeyCap.Size.Mini, Theme);
		KeyCap keyCap2 = new KeyCap("Alt", "alt", KeyCap.Size.Mini, Theme);
		liveCaps.Add(keyCap);
		liveCaps.Add(keyCap2);
		TextBlock textBlock2 = Ui.Medium("and", 11.5, DS.Colors.TextSecondary);
		textBlock2.VerticalAlignment = VerticalAlignment.Center;
		Grid grid2 = new Grid
		{
			Width = 44.0,
			Height = 44.0
		};
		grid2.Children.Add(new Border
		{
			CornerRadius = new CornerRadius(8.0),
			Background = Ui.Brush(DS.White(0.06)),
			BorderBrush = Ui.Brush(DS.White(0.14)),
			BorderThickness = new Thickness(0.5)
		});
		grid2.Children.Add(Icons.Glyph("\ue70f", 18.0, Theme));
		TextBlock textBlock3 = Ui.Medium("highlight anything, then ask", 11.5, DS.Colors.TextSecondary);
		textBlock3.VerticalAlignment = VerticalAlignment.Center;
		stackPanel.Children.Add(textBlock);
		stackPanel.Children.Add(Ui.H(7.0, keyCap, keyCap2));
		stackPanel.Children.Add(textBlock2);
		stackPanel.Children.Add(grid2);
		stackPanel.Children.Add(Ui.Shrink(textBlock3));
		Grid item2 = (Grid)(statusLine = new Grid
		{
			Height = 14.0
		});
		UpdateStatus();
		StackPanel stackPanel2 = new StackPanel
		{
			Spacing = 10.0,
			Children = 
			{
				(UIElement)grid,
				(UIElement)stackPanel,
				(UIElement)item2
			}
		};
		stackPanel2.MaxWidth = 440.0;
		return Layout("Circle anything, ask about it", "Hold the keys, circle something on your screen with the cursor, and ask about it. Like this:", stackPanel2);
	}

	private FrameworkElement TextModePage()
	{
		KeyCap keyCap = new KeyCap("Ctrl", "control", KeyCap.Size.Regular, Theme);
		liveCaps.Add(keyCap);
		TextBlock item = Ui.Text("tap it twice, quickly", 11.0, FontWeights.Medium, DS.Colors.TextSecondary, TextAlignment.Center);
		Grid grid = new Grid
		{
			Height = 16.0
		};
		if (s.Presenter.Presentation is NotchPresentation.TextResponse)
		{
			grid.Children.Add(Ui.Text("answering in the notch…", 11.5, FontWeights.Medium, DS.Colors.TextSecondary, TextAlignment.Center));
		}
		GhostDoubleTap(keyCap);
		return Layout("Not in the mood to talk? Type", "Double-tap Ctrl and you can just talk to me ChatGPT style. But, just a note I use Claude in the background!", new StackPanel
		{
			Spacing = 14.0,
			Children = 
			{
				(UIElement)Ui.H(12.0, keyCap).Center(),
				(UIElement)item,
				(UIElement)grid
			}
		});
	}

	private void GhostDoubleTap(KeyCap cap)
	{
		if (Anim.Instant)
		{
			return;
		}
		DispatcherQueueTimer t = dq.CreateTimer().Rooted();
		t.Interval = TimeSpan.FromSeconds(2.6);
		t.Tick += (DispatcherQueueTimer _, object _) =>
		{
			if (step != Step.TextMode || !window.Root.IsLoaded)
			{
				t.Stop();
			}
			else
			{
				cap.Pressed = true;
				After(0.14, () =>
				{
					cap.Pressed = false;
				});
				After(0.3, () =>
				{
					cap.Pressed = true;
				});
				After(0.44, () =>
				{
					cap.Pressed = false;
				});
			}
		};
		t.Start();
	}

	private FrameworkElement InterviewPage()
	{
		TextBlock item = Ui.Text("I'm curious about you.", 20.0, FontWeights.SemiBold, DS.Colors.TextPrimary, TextAlignment.Center, 0, wrap: true);
		TextBlock textBlock = Ui.Text("Four quick questions about you, so I can make this whole thing actually useful for you.", 13.0, FontWeights.Medium, DS.Colors.TextSecondary, TextAlignment.Center, 0, wrap: true);
		textBlock.LineHeight = 19.29;
		textBlock.LineStackingStrategy = LineStackingStrategy.BlockLineHeight;
		StackPanel item2 = new StackPanel
		{
			Spacing = 8.0,
			MaxWidth = 480.0,
			HorizontalAlignment = HorizontalAlignment.Center,
			Children = 
			{
				(UIElement)item,
				(UIElement)textBlock
			}
		};
		Grid grid = new Grid();
		grid.RowDefinitions.Add(new RowDefinition
		{
			Height = GridLength.Auto
		});
		grid.RowDefinitions.Add(new RowDefinition
		{
			Height = new GridLength(1.0, GridUnitType.Star)
		});
		grid.Children.Add(item2);
		InterviewController interview = Interview;
		if (interview != null)
		{
			InterviewStage interviewStage = new InterviewStage(s, interview)
			{
				VerticalAlignment = VerticalAlignment.Bottom
			};
			Grid.SetRow(interviewStage, 1);
			grid.Children.Add(interviewStage);
		}
		return grid;
	}

	private void InterviewStepChanged(Step from, Step to)
	{
		InterviewController interview = Interview;
		if (interview != null)
		{
			if (to < Step.ClickyInterview)
			{
				interview.WantsPreparedOpening = true;
				interview.PrepareOpening();
			}
			else if (to > Step.ClickyInterview)
			{
				interview.CancelPreparedOpening();
			}
			else
			{
				interview.WantsPreparedOpening = false;
			}
			if (to == Step.ClickyInterview && from != Step.ClickyInterview)
			{
				interview.Start();
			}
			else if (from == Step.ClickyInterview && to != Step.ClickyInterview)
			{
				interview.Stop();
			}
		}
	}

	private void OnInterviewCompleted()
	{
		Vm?.NoteInterviewFinished();
		Complete(Step.ClickyInterview, autoAdvance: false);
	}

	private FrameworkElement FinalePage()
	{
		Grid grid = new Grid
		{
			Width = 88.0,
			Height = 88.0,
			HorizontalAlignment = HorizontalAlignment.Center
		};
		grid.Children.Add(Ui.GlowSpot(Theme, 0.35, 168.0, 0.3).Pad(-40.0));
		grid.Children.Add(Ui.GlowSpot(Theme, 0.55, 132.0, 0.35).Pad(-22.0));
		grid.Children.Add(IntroMark.Create(88.0, Theme));
		GelButton show = new GelButton("Show me", GelAppearance.PrimaryBlue, GelButton.Sizing.Large, 100.0)
		{
			HorizontalAlignment = HorizontalAlignment.Center
		};
		finaleShowMe = show;
		show.Click += () =>
		{
			if (!show.IsLoading)
			{
				Func<bool>? canDrawFinale = CanDrawFinale;
				if (canDrawFinale != null && canDrawFinale())
				{
					Func<Task> runDrawnFinale = RunDrawnFinale;
					if (runDrawnFinale != null)
					{
						revealRunning = true;
						poll.Stop();
						Sounds.Play("clicky-text-open", 0.4);
						Anim.Opacity(window.Root, 0f, 1.25, Easing.EaseInOut(Ui.Compositor));
						After(1.25, () =>
						{
							window.HideWindow();
							window.Root.Opacity = 1.0;
						});
						runDrawnFinale();
						return;
					}
				}
				Func<bool>? canReveal = CanReveal;
				if (canReveal != null && canReveal())
				{
					Func<Task> reveal = RunReveal;
					if (reveal != null)
					{
						InterviewController interview = Interview;
						if (interview != null && interview.IsPlanInFlight)
						{
							show.Title = "One moment...";
							show.IsLoading = true;
							AutomationProperties.SetName(show, "One moment, setting up your Clickys");
							WaitForPlan(interview, 120.0, () =>
							{
								DissolveInto(reveal, 0.7);
							});
						}
						else
						{
							DissolveInto(reveal, 0.0);
						}
						return;
					}
				}
				Sounds.Play("reveal-boot", 0.6);
				Anim.Opacity(window.Root, 0f, 1.25, Easing.EaseInOut(Ui.Compositor));
				After(1.3, () =>
				{
					window.Root.Opacity = 1.0;
					End("finished");
				});
			}
		};
		return Layout("There's one more thing...", "Voice, drawing, text mode, agents: you've seen it all. But, hey, can I show you one more thing?", new StackPanel
		{
			Spacing = 44.0,
			Children = 
			{
				(UIElement)grid,
				(UIElement)show
			}
		});
	}

	private void DissolveInto(Func<Task> reveal, double extraPause)
	{
		revealRunning = true;
		poll.Stop();
		Sounds.Play("clicky-text-open", 0.4);
		Anim.Opacity(window.Root, 0f, 1.25, Easing.EaseInOut(Ui.Compositor));
		After(1.25 + extraPause, () =>
		{
			window.HideWindow();
			window.Root.Opacity = 1.0;
			reveal();
		});
	}

	private void WaitForPlan(InterviewController interview, double maxSeconds, Action then)
	{
		long started = Environment.TickCount64;
		DispatcherQueueTimer t = dq.CreateTimer().Rooted();
		t.Interval = TimeSpan.FromMilliseconds(250L, 0L);
		t.Tick += (DispatcherQueueTimer _, object _) =>
		{
			if (!interview.IsPlanInFlight || !((double)(Environment.TickCount64 - started) < maxSeconds * 1000.0))
			{
				t.Stop();
				pendingTimers.Remove(t);
				then();
			}
		};
		pendingTimers.Add(t);
		t.Start();
	}

	public void SkipForTests()
	{
		End("skipped");
	}

	public void FinishAfterReveal()
	{
		if (revealRunning)
		{
			revealRunning = false;
			shown = false;
			OnboardingTutorialViewModel vm = Vm;
			if (vm != null)
			{
				vm.End("finished");
			}
			else
			{
				s.Settings.HasCompletedTutorial = true;
			}
			TrackResolved("finished", Step.Finale);
			StepChanged?.Invoke(null);
			Ended?.Invoke();
		}
	}

	private void ReadSystemVolume()
	{
		if (volumeReadInFlight)
		{
			return;
		}
		volumeReadInFlight = true;
		Task.Run(() =>
		{
			double? level;
			try
			{
				level = SystemVolume.EffectiveLevel();
			}
			catch (Exception)
			{
				level = null;
			}
			dq.TryEnqueue(() =>
			{
				volumeReadInFlight = false;
				if (level.HasValue)
				{
					double valueOrDefault = level.GetValueOrDefault();
					systemVolume = valueOrDefault;
				}
			});
		});
	}

	private void Tick()
	{
		if (!window.Root.IsLoaded)
		{
			return;
		}
		Step step = this.step;
		bool flag = (uint)step <= 1u;
		if (flag && ++volumeTicks % 15 == 0)
		{
			ReadSystemVolume();
		}
		if (this.step == Step.SpeakerCheck && !completed.Contains(this.step) && systemVolume > 0.05)
		{
			ClickyAnalytics.TrackOnboardingTutorialSpeakerVolumeFixed("self");
			Complete(Step.SpeakerCheck, autoAdvance: true);
			Render(animated: false);
		}
		if (this.step == Step.DrawDemo)
		{
			OnboardingTutorialViewModel vm = Vm;
			if (vm != null && volumeTicks++ % 10 == 0)
			{
				Func<bool>? drawingShown = DrawingShown;
				if (drawingShown != null && drawingShown())
				{
					vm.NoteDrawingPresented();
				}
			}
		}
		if ((object)meter != null)
		{
			float level = s.Microphone.Level;
			meter.SetLevel(level);
			if ((double)level > 0.25)
			{
				loudSeconds += 0.033;
			}
			else
			{
				loudSeconds = Math.Max(0.0, loudSeconds - 0.0165);
			}
			if (loudSeconds >= 0.25 && this.step == Step.MicCheck)
			{
				Complete(Step.MicCheck, autoAdvance: false);
			}
		}
		if (liveCaps.Count > 0 && this.step != Step.TextMode)
		{
			bool flag2 = (Native.GetAsyncKeyState(17) & 0x8000) != 0;
			bool flag3 = (Native.GetAsyncKeyState(18) & 0x8000) != 0;
			for (int i = 0; i < liveCaps.Count; i++)
			{
				KeyCap keyCap = liveCaps[i];
				int? virtualKey = liveCaps[i].VirtualKey;
				bool pressed;
				if (virtualKey.HasValue)
				{
					int valueOrDefault = virtualKey.GetValueOrDefault();
					pressed = (Native.GetAsyncKeyState(valueOrDefault) & 0x8000) != 0;
				}
				else
				{
					pressed = ((i % 2 == 0) ? flag2 : flag3);
				}
				keyCap.Pressed = pressed;
			}
		}
		else if (liveCaps.Count == 1)
		{
			liveCaps[0].Pressed = liveCaps[0].Pressed;
		}
	}

	public void NoteCompanionTurnFinished(CompanionTurnFinish finish)
	{
		OnboardingTutorialViewModel vm = Vm;
		if (vm == null || !vm.IsEngaged || !finish.WordedTurn || finish.SpokenText.Length == 0)
		{
			return;
		}
		InterviewController? interview = Interview;
		if (interview != null && interview.IsActive)
		{
			return;
		}
		InterviewController? interview2 = Interview;
		if (interview2 == null || !interview2.IsWrappingUp)
		{
			Log.Info("tutorial", $"companion turn finished on {step}: {finish.HeardLines.Count} line(s) heard, drew={finish.DrewMarks}");
			if (step == Step.DrawDemo && finish.DrewMarks)
			{
				vm.NoteDrawingPresented();
			}
			vm.NoteCompanionTurnCompletedAsync();
		}
	}

	private void OnVoiceState()
	{
		VoiceState state = s.Companion.State;
		UpdateStatus();
		OnboardingTutorialViewModel vm = Vm;
		if (vm != null)
		{
			if (lastVoice == VoiceState.Idle && state != VoiceState.Idle)
			{
				vm.NoteCompanionTurnStarted();
				if (step == Step.DrawDemo && state == VoiceState.Listening)
				{
					BeginDrawStepStageIfNeeded();
				}
			}
			lastVoice = state;
			return;
		}
		if (lastVoice == VoiceState.Responding && state == VoiceState.Idle)
		{
			switch (step)
			{
			case Step.VoiceHello:
				Complete(step, autoAdvance: false);
				break;
			case Step.DrawDemo:
				After(0.6, () =>
				{
					Complete(Step.DrawDemo, autoAdvance: true);
				});
				break;
			case Step.DrawToAsk:
				Complete(step, autoAdvance: true);
				break;
			}
		}
		lastVoice = state;
	}

	private void OnPresentation()
	{
		NotchPresentation presentation = s.Presenter.Presentation;
		NotchPresentation notchPresentation = lastPresentation;
		lastPresentation = presentation;
		if (step != Step.TextMode)
		{
			return;
		}
		OnboardingTutorialViewModel vm = Vm;
		if (vm != null)
		{
			if (presentation is NotchPresentation.TextInput textInput)
			{
				if (!(notchPresentation is NotchPresentation.TextInput))
				{
					composerSeen = true;
					composerClosingForCountdown = false;
					vm.NoteTextComposerOpened();
				}
				else if (textInput.Draft.Length > 0)
				{
					vm.NoteTextComposerTyping();
				}
			}
			else if (presentation is NotchPresentation.TextResponse)
			{
				typedTurnInFlight = true;
			}
			else if (presentation is NotchPresentation.Idle && composerSeen)
			{
				composerSeen = false;
				if (typedTurnInFlight)
				{
					typedTurnInFlight = false;
					vm.NoteTypedTurnFinishedAsync();
				}
				else if (!composerClosingForCountdown)
				{
					vm.NoteTextComposerClosedByUser();
				}
				composerClosingForCountdown = false;
			}
		}
		else if (presentation is NotchPresentation.TextInput)
		{
			composerSeen = true;
			Complete(Step.TextMode, autoAdvance: false);
		}
		else
		{
			if (!composerSeen || !(presentation is NotchPresentation.Idle))
			{
				return;
			}
			composerSeen = false;
			After(2.0, () =>
			{
				if (step == Step.TextMode)
				{
					Advance();
				}
			});
		}
	}

	public void MarkCompleted(Step st)
	{
		Complete(st, autoAdvance: false);
	}

	private void After(double seconds, Action a)
	{
		DispatcherQueueTimer t = dq.CreateTimer().Rooted();
		t.Interval = TimeSpan.FromSeconds(seconds);
		t.IsRepeating = false;
		pendingTimers.Add(t);
		t.Tick += (DispatcherQueueTimer _, object _) =>
		{
			pendingTimers.Remove(t);
			a();
		};
		t.Start();
	}

	private void BeginDrawStepStageIfNeeded()
	{
		if (step != Step.DrawDemo || completed.Contains(Step.DrawDemo) || drawStepStage != null)
		{
			return;
		}
		OnboardingTutorialViewModel vm = Vm;
		if (vm != null)
		{
			vm.DrawStepStageOwnsCompletion = () => drawStepStage != null;
		}
		Log.Info("tutorial", $"draw step: press, the panel stays until the drawing starts (canvas open {Canvas?.IsShowing ?? false}, drawing up {Canvas?.IsShowingDrawing ?? false}, narrating {Canvas?.IsStreamingNarration ?? false})");
		window.SetTemporarilyHiddenFromOwnCapture(hidden: true);
		RunDrawStepStageAsync(drawStepStage = new CancellationTokenSource());
	}

	private async Task RunDrawStepStageAsync(CancellationTokenSource stage)
	{
		CancellationToken ct = stage.Token;
		DateTime startedAt = DateTime.UtcNow;
		bool sawTurn = false;
		bool panelHidden = false;
		bool clearsBeforeTheVoiceEnds = false;
		bool sawNarration = false;
		DateTime? quietSince = null;
		try
		{
			while (!ct.IsCancellationRequested && (DateTime.UtcNow - startedAt).TotalSeconds < 240.0)
			{
				await Task.Delay(100, ct);
				if (step != Step.DrawDemo)
				{
					break;
				}
				bool flag = Canvas?.IsStreamingNarration ?? false;
				bool flag2 = Canvas?.IsShowingDrawing ?? false;
				sawNarration |= flag;
				bool keysHeld = s.Companion.State == VoiceState.Listening;
				if (!panelHidden && DrawStepStagePolicy.PanelStepsAside(keysHeld, flag, flag2, sawNarration))
				{
					panelHidden = true;
					Log.Info("tutorial", $"draw step: the panel steps aside (narration {flag}, drawing {flag2})");
					SetPanelHidden(hidden: true, 0.45);
				}
				if (panelHidden & flag2)
				{
					DateTime? dateTime = Canvas?.NarrationAudioEndsAt;
					if (dateTime.HasValue)
					{
						DateTime valueOrDefault = dateTime.GetValueOrDefault();
						dateTime = Canvas.LatestLineReleasedAt;
						if (dateTime.HasValue)
						{
							DateTime valueOrDefault2 = dateTime.GetValueOrDefault();
							if (valueOrDefault2 > startedAt)
							{
								DateTime dateTime2 = Max(valueOrDefault.AddSeconds(-0.7), valueOrDefault2.AddSeconds(2.5));
								if (DateTime.UtcNow >= dateTime2)
								{
									clearsBeforeTheVoiceEnds = true;
									break;
								}
							}
						}
					}
				}
				if ((s.Companion.State != VoiceState.Idle) | flag)
				{
					sawTurn = true;
					quietSince = null;
				}
				else if (sawTurn || !((DateTime.UtcNow - startedAt).TotalSeconds < 2.5))
				{
					quietSince.GetValueOrDefault();
					if (!quietSince.HasValue)
					{
						DateTime utcNow = DateTime.UtcNow;
						quietSince = utcNow;
					}
					if ((DateTime.UtcNow - quietSince.Value).TotalSeconds >= (panelHidden ? 0.15 : 1.4))
					{
						break;
					}
				}
			}
		}
		catch (OperationCanceledException)
		{
			return;
		}
		if (ct.IsCancellationRequested)
		{
			return;
		}
		if (clearsBeforeTheVoiceEnds)
		{
			Vm?.NoteDrawingPresented();
		}
		bool flag3 = Vm?.DrawDidPresentThisStep ?? clearsBeforeTheVoiceEnds;
		if (flag3 && step == Step.DrawDemo)
		{
			Canvas?.Clear();
		}
		drawStepStage = null;
		window.SetTemporarilyHiddenFromOwnCapture(hidden: false);
		if (!shown || revealRunning)
		{
			return;
		}
		if (flag3 && step == Step.DrawDemo)
		{
			OnboardingTutorialViewModel vm = Vm;
			if (vm != null)
			{
				vm.CompleteDrawStepFromStage();
			}
			else
			{
				Complete(Step.DrawDemo, autoAdvance: false);
				Advance();
			}
		}
		if (panelHidden)
		{
			SetPanelHidden(hidden: false);
		}
		Log.Info("tutorial", $"draw step stage over (drew: {flag3}, early fade: {clearsBeforeTheVoiceEnds})");
	}

	private static DateTime Max(DateTime a, DateTime b)
	{
		if (!(a > b))
		{
			return b;
		}
		return a;
	}

	private void CancelDrawStepStage(bool bringPanelBack)
	{
		CancellationTokenSource cancellationTokenSource = drawStepStage;
		if (cancellationTokenSource != null)
		{
			cancellationTokenSource.Cancel();
			drawStepStage = null;
			window.SetTemporarilyHiddenFromOwnCapture(hidden: false);
			if (bringPanelBack && shown)
			{
				SetPanelHidden(hidden: false);
			}
		}
	}

	private void SetPanelHidden(bool hidden, double fadeSeconds = 0.0)
	{
		if (hidden)
		{
			if (fadeSeconds > 0.0 && !Anim.Instant)
			{
				Anim.Opacity(window.Root, 0f, fadeSeconds, Easing.EaseInOut(Ui.Compositor));
				After(fadeSeconds, window.HideWindow);
			}
			else
			{
				window.HideWindow();
			}
		}
		else
		{
			window.Root.Opacity = 1.0;
			Anim.Opacity(window.Root, 1f, 0.01);
			window.ShowNoActivate();
		}
	}

	private void DrawingStepChanged(Step from, Step to)
	{
		if (from == to)
		{
			return;
		}
		if (from == Step.ClickyDrive)
		{
			CancelDriveDemo();
		}
		if ((uint)(from - 4) <= 1u)
		{
			IScreenDrawingCanvas canvas = Canvas;
			if (canvas != null && (canvas.IsShowing || canvas.IsStreamingNarration))
			{
				canvas.Clear();
			}
		}
	}

	private void PopContinue(GelButton button)
	{
		if (Anim.Instant || Anim.ReduceMotion)
		{
			return;
		}
		button.Loaded += (object _, RoutedEventArgs _) =>
		{
			Vector3 center = new Vector3((float)button.ActualWidth / 2f, (float)button.ActualHeight / 2f, 0f);
			Anim.ScaleSpring(button, 1.14f, new SwiftSpring(0.22, 0.5), center);
			After(0.2, () =>
			{
				Anim.ScaleSpring(button, 1f, new SwiftSpring(0.42, 0.55), center);
			});
		};
	}

	private FrameworkElement ClickyDrivePage()
	{
		TourDrive.Completed = () =>
		{
			dq.TryEnqueue(() =>
			{
				OnboardingTutorialViewModel vm = Vm;
				if (vm != null)
				{
					vm.NoteDriveDemoFinished();
				}
				else
				{
					Complete(Step.ClickyDrive, autoAdvance: false);
				}
			});
		};
		StackPanel stackPanel = new StackPanel
		{
			Orientation = Orientation.Horizontal,
			Spacing = 7.0,
			HorizontalAlignment = HorizontalAlignment.Center
		};
		TextBlock textBlock = Ui.Medium("Hold", 11.5, DS.Colors.TextSecondary);
		textBlock.VerticalAlignment = VerticalAlignment.Center;
		List<KeyCap> list = KeyCap.ForBinding(s.Settings.PushToTalkBinding, KeyCap.Size.Mini, Theme);
		liveCaps.AddRange(list);
		TextBlock textBlock2 = Ui.Medium("and say", 11.5, DS.Colors.TextSecondary);
		textBlock2.VerticalAlignment = VerticalAlignment.Center;
		stackPanel.Children.Add(textBlock);
		UIElementCollection children = stackPanel.Children;
		int num = 0;
		UIElement[] array = new UIElement[list.Count];
		foreach (KeyCap item2 in list)
		{
			array[num] = item2;
			num++;
		}
		children.Add(Ui.H(7.0, array));
		stackPanel.Children.Add(textBlock2);
		StackPanel stackPanel2 = new StackPanel
		{
			Spacing = 8.0,
			Children = 
			{
				(UIElement)stackPanel,
				(UIElement)new SpokenBubble("Please drive my computer and make a list")
			}
		};
		Func<Color, FrameworkElement, Func<bool>, FrameworkElement> stepContent = TourDrive.StepContent;
		FrameworkElement interactive;
		if (stepContent != null)
		{
			interactive = stepContent(Theme, stackPanel2, () => completed.Contains(Step.ClickyDrive));
		}
		else
		{
			Grid item = (Grid)(statusLine = new Grid
			{
				Height = 14.0
			});
			UpdateStatus();
			interactive = new StackPanel
			{
				Spacing = 12.0,
				Children = 
				{
					(UIElement)stackPanel2,
					(UIElement)item
				}
			};
		}
		return Layout("I can drive your computer too", "Ask me to do it and I'll take the mouse while you watch. Move it anytime and it's yours again.", interactive);
	}

	public bool InterceptPushToTalkRelease()
	{
		if (!shown || revealRunning || step != Step.ClickyDrive)
		{
			return false;
		}
		Action run = TourDrive.Run;
		if (run != null)
		{
			run();
		}
		else
		{
			Log.Info("tutorial", "drive step: no drive in this build; the ask completes the step");
			OnboardingTutorialViewModel vm = Vm;
			if (vm != null)
			{
				vm.NoteDriveDemoFinished();
			}
			else
			{
				Complete(Step.ClickyDrive, autoAdvance: false);
			}
		}
		return true;
	}

	private void CancelDriveDemo()
	{
		TourDrive.Cancel?.Invoke();
	}

	internal void PressShowMeForTests()
	{
		finaleShowMe?.RaiseClick();
	}
}
