using System;
using System.Collections.Generic;
using HeyClicky.App.Browser;
using HeyClicky.App.Design;
using HeyClicky.App.UI;
using Microsoft.UI;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Shapes;

namespace HeyClicky.App.Dock;

internal sealed class FooterRequestRow : StackPanel
{
	private const double HorizontalInset = 22.0;

	private readonly ArcDock dock;

	private readonly ArcCardContent content;

	private readonly string analyticsSurface;

	public FooterRequestRow(ArcDock dock, ArcCardContent content, CardFooterRequest request, double? buttonHeight, string analyticsSurface = "dock_window")
	{
		this.dock = dock;
		this.content = content;
		this.analyticsSurface = analyticsSurface;
		Padding = new Thickness(22.0, 12.0, 22.0, 12.0);
		Spacing = 9.0;
		if (request.Kind == CardFooterRequest.Kinds.Ready)
		{
			CardReadyOutput ready = request.Ready;
			if ((object)ready != null)
			{
				Children.Add(ReadyButtons(ready, buttonHeight));
				return;
			}
		}
		Grid grid = new Grid
		{
			ColumnSpacing = 10.0
		};
		grid.ColumnDefinitions.Add(new ColumnDefinition
		{
			Width = GridLength.Auto
		});
		grid.ColumnDefinitions.Add(new ColumnDefinition
		{
			Width = new GridLength(1.0, GridUnitType.Star)
		});
		FrameworkElement frameworkElement2;
		if (request.Kind == CardFooterRequest.Kinds.ConnectChrome)
		{
			FrameworkElement frameworkElement = ChromeIcon.Make(32.0);
			if ((object)frameworkElement != null)
			{
				frameworkElement2 = frameworkElement;
				goto IL_019b;
			}
		}
		HandoffGlyph? glyph = request.Glyph;
		if (glyph.HasValue)
		{
			HandoffGlyph valueOrDefault = glyph.GetValueOrDefault();
			frameworkElement2 = new HandoffChipView(valueOrDefault, content.RailKey);
		}
		else
		{
			frameworkElement2 = new Grid
			{
				Width = 32.0,
				Height = 32.0,
				Children = 
				{
					(UIElement)new Ellipse
					{
						Fill = Ui.Brush(ArcColors.Of(request.IconBackground))
					},
					(UIElement)ArcSymbols.Make(request.Symbol, 14.0, Colors.White)
				}
			};
		}
		goto IL_019b;
		IL_019b:
		frameworkElement2.VerticalAlignment = VerticalAlignment.Top;
		grid.Children.Add(frameworkElement2);
		StackPanel stackPanel = new StackPanel
		{
			Spacing = 3.0
		};
		StackPanel stackPanel2 = new StackPanel
		{
			Orientation = Orientation.Horizontal,
			Spacing = 8.0
		};
		stackPanel2.Children.Add(Ui.Text(request.Title, 16.5, FontWeights.SemiBold, ArcColors.Ink));
		if (request.Glyph.HasValue)
		{
			stackPanel2.Children.Add(new PaperStampView("you", DS.Hex(12081670u), 8.5, NotePaperColors.Seed(content.RailKey) % 5 - 7));
		}
		stackPanel.Children.Add(stackPanel2);
		stackPanel.Children.Add(Ui.Text(request.Detail, 14.0, FontWeights.Normal, ArcColors.Ink.WithAlpha(0.6), TextAlignment.Left, 3));
		Grid.SetColumn(stackPanel, 1);
		grid.Children.Add(stackPanel);
		Children.Add(grid);
		FirstThatFitsHorizontally firstThatFitsHorizontally = new FirstThatFitsHorizontally
		{
			Margin = new Thickness(42.0, 0.0, 0.0, 0.0)
		};
		if (!buttonHeight.HasValue)
		{
			firstThatFitsHorizontally.Children.Add(Row(request, isLarge: true, buttonHeight));
		}
		firstThatFitsHorizontally.Children.Add(Row(request, isLarge: false, buttonHeight));
		DockFlow dockFlow = new DockFlow
		{
			HorizontalSpacing = 8.0,
			VerticalSpacing = 8.0
		};
		foreach (FrameworkElement item in Buttons(request, isLarge: false, buttonHeight))
		{
			dockFlow.Children.Add(item);
		}
		firstThatFitsHorizontally.Children.Add(dockFlow);
		Children.Add(firstThatFitsHorizontally);
		AutomationProperties.SetName(this, request.Title + ". " + request.Detail);
	}

	private FrameworkElement Row(CardFooterRequest request, bool isLarge, double? buttonHeight)
	{
		StackPanel stackPanel = new StackPanel
		{
			Orientation = Orientation.Horizontal,
			Spacing = 8.0
		};
		foreach (FrameworkElement item in Buttons(request, isLarge, buttonHeight))
		{
			stackPanel.Children.Add(item);
		}
		return stackPanel;
	}

	private IEnumerable<FrameworkElement> Buttons(CardFooterRequest request, bool isLarge, double? buttonHeight)
	{
		double? labelSize;
		if (isLarge)
		{
			labelSize = 15.5;
		}
		else
		{
			labelSize = ((!buttonHeight.HasValue) ? ((double?)null) : new double?(13.0));
		}
		GelButton.Sizing sizing = (isLarge ? GelButton.Sizing.Large : GelButton.Sizing.Normal);
		switch (request.Kind)
		{
		case CardFooterRequest.Kinds.ComputerUse:
		{
			string taskId2 = content.TaskId;
			if (taskId2 != null)
			{
				yield return Button("Let HeyClicky drive", null, GelAppearance.PrimaryBlue, "drive_approved", () =>
				{
					dock.LetClickyDrive(taskId2);
				});
				yield return Button("Not now", null, GelAppearance.SecondaryWhite, "drive_declined", () =>
				{
					dock.DeclineComputerUse(taskId2);
				});
			}
			break;
		}
		case CardFooterRequest.Kinds.Failed:
		case CardFooterRequest.Kinds.Stopped:
			yield return Button("Retry", "arrow.clockwise", GelAppearance.PrimaryBlue, "retry", () =>
			{
				dock.Retry(content);
			});
			break;
		case CardFooterRequest.Kinds.ConnectChrome:
		{
			bool canDrive = ChromeSetupFlow.Shared.CanDoItForThem;
			if (canDrive)
			{
				yield return Button("Install for me", null, GelAppearance.PrimaryBlue, "chrome_install_for_me", () =>
				{
					dock.ChooseChrome(ChromeSetupFlow.Choice.DoItForMe, content);
				});
			}
			yield return Button("I'll install it", null, canDrive ? GelAppearance.SecondaryWhite : GelAppearance.PrimaryBlue, "chrome_show_me_how", () =>
			{
				dock.ChooseChrome(ChromeSetupFlow.Choice.ShowMeHow, content);
			});
			yield return Button("Not now", null, GelAppearance.SecondaryWhite, "chrome_not_now", () =>
			{
				dock.ChooseChrome(ChromeSetupFlow.Choice.NotNow, content);
			});
			break;
		}
		case CardFooterRequest.Kinds.UserStep:
		{
			string jobId = content.JobId;
			if (jobId != null)
			{
				yield return Button("I'm done", "checkmark", GelAppearance.PrimaryBlue, "user_step_done", () =>
				{
					dock.ContinueAfterUserStep(jobId);
				});
			}
			break;
		}
		case CardFooterRequest.Kinds.ExtraUsage:
		{
			string taskId = content.TaskId;
			if (taskId != null)
			{
				yield return Button("Always approve", "infinity", GelAppearance.PrimaryBlue, "extra_usage_always_approve", () =>
				{
					dock.ApproveExtraUsage(taskId, always: true);
				});
				yield return Button("Approve once", null, GelAppearance.SecondaryWhite, "extra_usage_approve_once", () =>
				{
					dock.ApproveExtraUsage(taskId, always: false);
				});
			}
			break;
		}
		}
		GelButton Button(string title, string? symbol, GelAppearance appearance, string answer, Action click)
		{
			return ArcButtons.Gel(title, symbol, appearance, buttonHeight, labelSize, sizing, () =>
			{
				TrackAnswer(answer);
				click();
			});
		}
	}

	private FrameworkElement ReadyButtons(CardReadyOutput output, double? buttonHeight)
	{
		string text = output.ButtonSymbol;
		if (text == null)
		{
			CardReadyOutput.Kinds kind = output.Kind;
			bool flag = ((kind == CardReadyOutput.Kinds.File || kind == CardReadyOutput.Kinds.Several) ? true : false);
			text = (flag ? output.Symbol : null);
		}
		string symbol = text;
		bool flag2 = !buttonHeight.HasValue;
		StackPanel stackPanel = new StackPanel
		{
			Orientation = Orientation.Horizontal,
			Spacing = 8.0
		};
		stackPanel.Children.Add(ArcButtons.Gel(output.ButtonTitle, symbol, GelAppearance.PrimaryBlue, buttonHeight, flag2 ? 15.5 : 13.0, flag2 ? GelButton.Sizing.Large : GelButton.Sizing.Normal, () =>
		{
			TrackAnswer("open_output");
			dock.OpenReadyOutput(content.RailKey, output);
		}));
		string jobId = content.JobId;
		if (jobId != null)
		{
			stackPanel.Children.Add(ArcButtons.Gel("Show me", null, GelAppearance.SecondaryWhite, buttonHeight, flag2 ? 15.5 : 13.0, flag2 ? GelButton.Sizing.Large : GelButton.Sizing.Normal, () =>
			{
				TrackAnswer("show_me");
				dock.ShowJobThroughBrain("job:" + jobId);
			}));
		}
		AutomationProperties.SetName(stackPanel, output.Title + ". " + output.ButtonTitle);
		return stackPanel;
	}

	private void TrackAnswer(string answer)
	{
		dock.TrackRequestAnswered(answer, analyticsSurface, content.RailKey, content.TaskId);
	}
}
