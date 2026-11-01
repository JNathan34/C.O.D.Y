using System;
using System.Collections.Generic;
using System.Linq;
using System.Numerics;
using System.Text.Json.Nodes;
using HeyClicky.Agents.Jobs;
using HeyClicky.App.Design;
using HeyClicky.App.Ink;
using HeyClicky.App.Notch.Surfaces;
using HeyClicky.App.UI;
using HeyClicky.Core.Telemetry;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Windows.UI;

namespace HeyClicky.App.Dock;

public sealed class ArcCardView : Grid
{
	private const double TitleBarHeight = 34.0;

	private readonly ArcDock dock;

	private readonly Grid screen;

	private readonly Grid titleBar;

	private readonly TextBlock stateLabel;

	private readonly Grid stateRow;

	private TypingDots? stateDots;

	private readonly CaptionButton closeButton;

	private readonly Grid bodyHost = new Grid();

	private readonly Border footerHost = new Border();

	private readonly Grid contentStack;

	private readonly Grid coverHost = new Grid
	{
		IsHitTestVisible = false
	};

	private readonly Pressable bodyPress;

	private readonly MenuFlyout contextMenu;

	private readonly Border paperFill = new Border();

	private readonly Border titleWash = new Border();

	private readonly Border footerWash = new Border();

	private ArcCardContent content;

	private string? shape;

	private bool showsCover;

	private bool isLive;

	private ArcProgressBar? footerProgress;

	private ArcProgressBar? coverProgress;

	private PlanRows? planRows;

	private bool liveLineRisesIn;

	private ResultCardFace? face;

	private string? sentChoice;

	private bool isDraftCopied;

	private ArcLiveNote? shownNote;

	private bool footerShowsTourLine;

	public string RailKey => content.RailKey;

	public ArcCardContent Content => content;

	private bool OpensOnClick
	{
		get
		{
			if (!content.IsWorking)
			{
				return !content.IsFinalizing;
			}
			return false;
		}
	}

	private bool IsQuietResult
	{
		get
		{
			if (content.IsDone)
			{
				return content.Answer?.IsQuiet ?? false;
			}
			return false;
		}
	}

	private bool CanRemoveFromDock
	{
		get
		{
			if (isLive && !content.IsFinalizing && content.State != ArcCardState.Pinning)
			{
				if (content.IsWorking)
				{
					return CanStopWork;
				}
				return true;
			}
			return false;
		}
	}

	private bool CanStopWork
	{
		get
		{
			if (!content.IsFinalizing)
			{
				return content.TaskIsRunning;
			}
			return false;
		}
	}

	public ArcCardView(ArcDock dock, ArcCardContent content)
	{
		ArcCardView arcCardView = this;
		this.dock = dock;
		this.content = content;
		Width = 494.0;
		Height = 314.0;
		var (radius, num) = StickyPreviewLayout.CornerRadii();
		Children.Add(new ShadowLayer(num, DS.Black(0.35), 20.0, 10.0));
		Children.Add(new Border
		{
			CornerRadius = new CornerRadius(num),
			Background = Ui.Vertical((0.0, DS.Rgb(0.16, 0.16, 0.16)), (1.0, DS.Rgb(0.08, 0.08, 0.08))),
			BorderBrush = Ui.Brush(DS.White(0.16)),
			BorderThickness = new Thickness(1.0)
		});
		screen = new Grid
		{
			Margin = new Thickness(7.0),
			Width = 480.0,
			Height = 300.0
		};
		screen.RowDefinitions.Add(new RowDefinition
		{
			Height = new GridLength(34.0)
		});
		screen.RowDefinitions.Add(new RowDefinition
		{
			Height = new GridLength(1.0, GridUnitType.Star)
		});
		Grid grid = new Grid
		{
			Children = 
			{
				(UIElement)paperFill,
				(UIElement)ArcPaperTexture.Create()
			}
		};
		Grid.SetRowSpan(grid, 2);
		screen.Children.Add(grid);
		titleBar = new Grid();
		titleBar.Children.Add(new Border
		{
			Background = Ui.Horizontal((0.0, ArcColors.TitleGreyEdge), (0.5, ArcColors.TitleGreyMiddle), (1.0, ArcColors.TitleGreyEdge))
		});
		titleBar.Children.Add(titleWash);
		titleBar.Children.Add(new Border
		{
			Height = 0.5,
			VerticalAlignment = VerticalAlignment.Bottom,
			Background = Ui.Brush(DS.Black(0.08))
		});
		stateLabel = Ui.Text("", 12.5, FontWeights.SemiBold, ArcColors.Ink);
		stateLabel.VerticalAlignment = VerticalAlignment.Center;
		stateRow = new Grid
		{
			HorizontalAlignment = HorizontalAlignment.Center,
			VerticalAlignment = VerticalAlignment.Center,
			ColumnSpacing = 5.0,
			IsHitTestVisible = false
		};
		stateRow.ColumnDefinitions.Add(new ColumnDefinition
		{
			Width = GridLength.Auto
		});
		stateRow.ColumnDefinitions.Add(new ColumnDefinition
		{
			Width = GridLength.Auto
		});
		stateRow.Children.Add(stateLabel);
		titleBar.Children.Add(stateRow);
		closeButton = new CaptionButton(CaptionButton.Kind.Close, 34.0, ArcColors.Ink.WithAlpha(0.8), "Remove from the dock")
		{
			HorizontalAlignment = HorizontalAlignment.Right,
			VerticalAlignment = VerticalAlignment.Top
		};
		closeButton.Click += () =>
		{
			bool canStopWork = arcCardView.CanStopWork;
			ArcDock.TrackWindowAction("removed_from_dock", arcCardView.content, new JsonObject { ["stops_work"] = canStopWork });
			if (canStopWork)
			{
				dock.StopWork(arcCardView.content);
			}
			dock.RemoveFromDock(arcCardView.content.RailKey);
		};
		titleBar.Children.Add(closeButton);
		screen.Children.Add(titleBar);
		contentStack = new Grid();
		contentStack.RowDefinitions.Add(new RowDefinition
		{
			Height = new GridLength(1.0, GridUnitType.Star)
		});
		contentStack.RowDefinitions.Add(new RowDefinition
		{
			Height = GridLength.Auto
		});
		bodyPress = new Pressable
		{
			Children = { (UIElement)bodyHost }
		};
		bodyPress.Click += () =>
		{
			if (arcCardView.OpensOnClick)
			{
				arcCardView.OpenFullResponse("card_click");
			}
		};
		contextMenu = ContextMenu();
		Ui.ClipRounded(bodyPress, 0.0);
		contentStack.Children.Add(bodyPress);
		Grid.SetRow(footerHost, 1);
		contentStack.Children.Add(footerHost);
		Grid grid2 = new Grid
		{
			Children = 
			{
				(UIElement)contentStack,
				(UIElement)coverHost
			}
		};
		Ui.ClipRounded(grid2, 0.0);
		Grid.SetRow(grid2, 1);
		screen.Children.Add(grid2);
		Ui.ClipRounded(screen, radius);
		Children.Add(screen);
		Apply(content, force: true);
	}

	private MenuFlyout ContextMenu()
	{
		MenuFlyout menuFlyout = new MenuFlyout();
		MenuFlyoutItem item = new MenuFlyoutItem();
		item.Click += (object _, RoutedEventArgs _) =>
		{
			OpenFullResponse("context_menu");
		};
		menuFlyout.Items.Add(item);
		menuFlyout.Opening += (object? _, object _) =>
		{
			item.Text = (dock.CanShowFullResponse(content) ? "Full report" : "Show in chat");
		};
		return menuFlyout;
	}

	private void ApplyOpensOnClick()
	{
		bool opensOnClick = OpensOnClick;
		bodyPress.Enabled = opensOnClick;
		bodyPress.ContextFlyout = (opensOnClick ? contextMenu : null);
	}

	private void OpenFullResponse(string via)
	{
		if (content.State == ArcCardState.Suggested)
		{
			TrackArcAction("start_now", new JsonObject { ["via"] = via });
		}
		else
		{
			JsonObject jsonObject = ArcDock.WindowProperties(content);
			jsonObject["action"] = "arc_show_full_response";
			jsonObject["via"] = via;
			jsonObject["has_reply"] = dock.CanShowFullResponse(content);
			ClickyAnalytics.TrackProductEvent("notch_peek_action", content.ClickySlug, content.ThreadId, jsonObject);
		}
		dock.OpenFullResponse(content);
	}

	private void TrackArcAction(string action, JsonObject? properties = null)
	{
		if (isLive)
		{
			ArcDock.TrackWindowAction(action, content, properties);
		}
	}

	public void SetPresentation(bool showsCover, bool isLive, bool animated = true)
	{
		bool flag = showsCover != this.showsCover;
		this.showsCover = showsCover;
		if (this.isLive != isLive)
		{
			this.isLive = isLive;
			ApplyTitleBar();
			if ((object)shownNote != null)
			{
				BuildBody();
			}
		}
		if (flag)
		{
			BuildCover(animated);
		}
	}

	public void Update(ArcCardContent next)
	{
		Apply(next, force: false);
	}

	private void Apply(ArcCardContent next, bool force)
	{
		ArcCardContent arcCardContent = content;
		content = next;
		paperFill.Background = Ui.Brush(next.Paper.Fill);
		titleWash.Background = Ui.Brush(next.Paper.TitleWash.WithAlpha(0.62));
		footerWash.Background = Ui.Brush(next.Paper.TitleWash.WithAlpha(0.62));
		ApplyTitleBar();
		ApplyOpensOnClick();
		if (force || next.Shape != shape)
		{
			shape = next.Shape;
			BuildBody();
			BuildFooter();
			BuildCover(animated: false);
			return;
		}
		if (ShowsTourLine() != footerShowsTourLine)
		{
			BuildFooter();
		}
		planRows?.Update(next.Plan, next.LiveLine);
		footerProgress?.Update(next.Plan);
		coverProgress?.Update(next.Plan);
		if (!object.Equals(BodyNote(), shownNote))
		{
			BuildBody();
		}
		else if ((object)shownNote == null && (object)planRows == null && next.IsWorking && (arcCardContent.CurrentStepLine != next.CurrentStepLine || !object.Equals(arcCardContent.LiveLine?.Text, next.LiveLine?.Text)))
		{
			liveLineRisesIn = (object)next.LiveLine != null && !object.Equals(arcCardContent.LiveLine?.Text, next.LiveLine.Text);
			BuildBody();
			liveLineRisesIn = false;
		}
	}

	private void ApplyTitleBar()
	{
		string text;
		if (IsQuietResult)
		{
			text = "Checked";
		}
		else
		{
			text = (content.IsFinalizing ? "Finalizing" : null);
		}
		bool isFinalizing = content.IsFinalizing;
		Color c = (((text == null) | isFinalizing) ? ArcColors.State(content.State) : ArcColors.Ink.WithAlpha(0.5));
		stateLabel.Text = text ?? ArcCardStates.Title(content.State);
		stateLabel.Foreground = Ui.Brush(c);
		bool flag = ArcCardStates.IsBusy(content.State);
		if (flag && (object)stateDots == null)
		{
			stateDots = new TypingDots(ArcColors.State(content.State), 0.5)
			{
				Margin = new Thickness(0.0, 2.0, 0.0, 0.0)
			};
			Grid.SetColumn(stateDots, 1);
			stateRow.Children.Add(stateDots);
		}
		else if (!flag && (object)stateDots != null)
		{
			stateRow.Children.Remove(stateDots);
			stateDots = null;
		}
		AutomationProperties.SetName(stateRow, stateLabel.Text);
		bool canRemoveFromDock = CanRemoveFromDock;
		closeButton.Visibility = ((!canRemoveFromDock) ? Visibility.Collapsed : Visibility.Visible);
		string value = (CanStopWork ? "Stop and remove from the dock" : "Remove from the dock");
		ToolTipService.SetToolTip(closeButton, value);
		AutomationProperties.SetName(closeButton, value);
	}

	private void BuildBody()
	{
		bodyHost.Children.Clear();
		planRows = null;
		face = null;
		shownNote = BodyNote();
		if (content.IsWorking)
		{
			ArcLiveNote arcLiveNote = shownNote;
			if ((object)arcLiveNote != null)
			{
				bodyHost.Children.Add(ArcDock.TopOfNote(arcLiveNote, isWorking: true, isLive));
				return;
			}
		}
		if (content.IsDone)
		{
			ClickyAnswer answer = content.Answer;
			if ((object)answer != null)
			{
				bodyHost.Children.Add(AnswerFace(answer));
				return;
			}
		}
		if (content.IsDone)
		{
			ArcLiveNote arcLiveNote2 = shownNote;
			if ((object)arcLiveNote2 != null)
			{
				bodyHost.Children.Add(DoneNote(arcLiveNote2));
				return;
			}
		}
		if (content.IsDone)
		{
			string summary = content.Summary;
			if (summary != null)
			{
				bodyHost.Children.Add(AnswerFace(new ClickyAnswer
				{
					Line = ClickyAnswer.Clean(summary, 220)
				}));
				return;
			}
		}
		bodyHost.Children.Add((content.State == ArcCardState.Suggested) ? SuggestedBody() : RegularBody());
	}

	private ArcLiveNote? BodyNote()
	{
		if (!content.IsWorking && (!content.IsDone || (object)content.Answer != null))
		{
			return null;
		}
		return dock.LiveNote(content);
	}

	private FrameworkElement DoneNote(ArcLiveNote note)
	{
		Grid grid = new Grid();
		FileCardStack fileCardStack = CardFiles();
		ClickyInkTopOfNote clickyInkTopOfNote = ArcDock.TopOfNote(note, isWorking: false, isLive);
		clickyInkTopOfNote.Margin = new Thickness(0.0, 0.0, ((object)fileCardStack == null) ? 0.0 : 132.0, 0.0);
		grid.Children.Add(clickyInkTopOfNote);
		if ((object)fileCardStack != null)
		{
			grid.Children.Add(fileCardStack);
		}
		return grid;
	}

	private FrameworkElement AnswerFace(ClickyAnswer answer)
	{
		Grid grid = new Grid();
		FileCardStack fileCardStack = CardFiles();
		face = new ResultCardFace(content.Title, answer, content.Paper.Ink, content.Paper.TitleWash, dock.ResultCardWhenLine(content, answer), isDraftCopied, sentChoice, (ClickyAnswer.Choice choice) =>
		{
			if (sentChoice == null)
			{
				sentChoice = choice.Reply;
				face?.Update(isDraftCopied, sentChoice);
				dock.AnswerResultCardQuestion(content, choice);
			}
		}, (string target) =>
		{
			TrackArcAction("result_link_opened", new JsonObject { ["artifact_kind"] = ClickyAnalytics.ProductArtifactKind(target) });
			dock.OpenResultCardTarget(target, content);
		})
		{
			Margin = new Thickness(0.0, 0.0, ((object)fileCardStack == null) ? 0.0 : 132.0, 0.0)
		};
		grid.Children.Add(face);
		if ((object)fileCardStack != null)
		{
			grid.Children.Add(fileCardStack);
		}
		if (!Anim.ReduceMotion)
		{
			face.Opacity = 0.0;
			face.Translation = new Vector3(0f, 8f, 0f);
			Anim.Opacity(face, 1f, 0.3);
			Anim.Translate(face, Vector3.Zero, 0.3);
		}
		return grid;
	}

	private FileCardStack? CardFiles()
	{
		return FileCardStack.Make(ArcCardContentSource.CardEntries(content), content.WorkspacePath, (string entry) =>
		{
			TrackArcAction("file_opened", new JsonObject
			{
				["via"] = "file_card",
				["artifact_kind"] = ClickyAnalytics.ProductArtifactKind(entry)
			});
			dock.OpenCardFile(entry, content);
		});
	}

	private FrameworkElement SuggestedBody()
	{
		FirstThatFits firstThatFits = new FirstThatFits
		{
			Margin = new Thickness(26.0, 20.0, 26.0, 10.0)
		};
		(double, double, double)[] suggested = ArcCover.Suggested;
		foreach ((double, double, double) sizes in suggested)
		{
			firstThatFits.Children.Add(SuggestedBlock(sizes));
		}
		firstThatFits.Children.Add(new ShrinkToFit(SuggestedBlock(ArcCover.Suggested[^1]), 0.6));
		return firstThatFits;
	}

	private FrameworkElement SuggestedBlock((double Title, double Body, double Spacing) sizes)
	{
		StackPanel stackPanel = new StackPanel
		{
			Spacing = sizes.Spacing
		};
		TextBlock textBlock = Ui.Text(content.Title, sizes.Title, FontWeights.Bold, content.Paper.Ink, TextAlignment.Left, 0, wrap: true);
		textBlock.FontFamily = DS.Fonts.Display;
		stackPanel.Children.Add(textBlock);
		string summary = content.Summary;
		if (summary != null)
		{
			stackPanel.Children.Add(Ui.Text(ArcCover.CardPitch(summary), sizes.Body, FontWeights.Medium, content.Paper.Ink.WithAlpha(0.72), TextAlignment.Left, 5, wrap: true));
		}
		return stackPanel;
	}

	private FrameworkElement RegularBody()
	{
		StackPanel stackPanel = new StackPanel
		{
			Spacing = 12.0,
			Margin = new Thickness(26.0, 20.0, 26.0, 10.0)
		};
		TextBlock textBlock = Ui.Text(content.Title, 26.0, FontWeights.Bold, content.Paper.Ink, TextAlignment.Left, 2);
		textBlock.FontFamily = DS.Fonts.Display;
		stackPanel.Children.Add(new ShrinkToFit(textBlock, 0.75, 2));
		Color ink = content.Paper.Ink;
		if (content.IsWorking)
		{
			stackPanel.Children.Add(WorkingBody());
		}
		else if (content.IsDone)
		{
			foreach (FrameworkElement item in DoneBody())
			{
				stackPanel.Children.Add(item);
			}
		}
		else
		{
			CardFooterRequest request = content.Request;
			if ((object)request != null)
			{
				stackPanel.Children.Add(Ui.Text(request.Detail, 20.0, FontWeights.Medium, ink.WithAlpha(0.72), TextAlignment.Left, 3));
			}
			else if (content.State == ArcCardState.Pinning)
			{
				stackPanel.Children.Add(Ui.Text("Pinning…", 20.0, FontWeights.Medium, ink.WithAlpha(0.6)));
			}
			else
			{
				stackPanel.Children.Add(Ui.Text("Nothing running. Hold the voice keys and give it something to do.", 19.0, FontWeights.Medium, ink.WithAlpha(0.55), TextAlignment.Left, 2));
			}
		}
		return stackPanel;
	}

	private FrameworkElement WorkingBody()
	{
		Color ink = content.Paper.Ink;
		ClickyArcPlan plan = content.Plan;
		if ((object)plan != null && !plan.IsEmpty)
		{
			planRows = new PlanRows(plan, content.LiveLine, ink);
			return planRows;
		}
		StackPanel stackPanel = new StackPanel
		{
			Orientation = Orientation.Horizontal,
			Spacing = 10.0
		};
		FrameworkElement frameworkElement = ActivityIndicators.ThinkingDots(ink.WithAlpha(0.6));
		frameworkElement.VerticalAlignment = VerticalAlignment.Center;
		stackPanel.Children.Add(frameworkElement);
		ClickyLiveLine liveLine = content.LiveLine;
		if ((object)liveLine != null)
		{
			stackPanel.Children.Add(new LiveLineView(liveLine, ink, 18.0, liveLineRisesIn)
			{
				VerticalAlignment = VerticalAlignment.Center
			});
		}
		else
		{
			TextBlock textBlock = Ui.Text(content.CurrentStepLine ?? "Getting started…", 19.0, FontWeights.Medium, ink.WithAlpha(0.65), TextAlignment.Left, 2);
			textBlock.VerticalAlignment = VerticalAlignment.Center;
			textBlock.MaxWidth = 390.0;
			stackPanel.Children.Add(textBlock);
		}
		return stackPanel;
	}

	private IEnumerable<FrameworkElement> DoneBody()
	{
		Color ink = content.Paper.Ink;
		string summary = content.Summary;
		if (summary != null)
		{
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
			FrameworkElement frameworkElement = ArcSymbols.Make("checkmark.circle.fill", 22.0, ArcColors.Working);
			frameworkElement.VerticalAlignment = VerticalAlignment.Top;
			frameworkElement.Margin = new Thickness(0.0, 1.0, 0.0, 0.0);
			grid.Children.Add(frameworkElement);
			TextBlock textBlock = Ui.Text(summary, 20.0, FontWeights.Medium, ink.WithAlpha(0.8), TextAlignment.Left, 2);
			Grid.SetColumn(textBlock, 1);
			grid.Children.Add(textBlock);
			yield return grid;
		}
		IReadOnlyList<string> readOnlyList = ArcCardContentSource.MainEntries(content.Files, content.WorkspacePath);
		if (readOnlyList.Count <= 0)
		{
			yield break;
		}
		StackPanel stackPanel = new StackPanel
		{
			Orientation = Orientation.Horizontal,
			Spacing = 8.0
		};
		foreach (string entry in readOnlyList.Take(3))
		{
			stackPanel.Children.Add(new ArcFileChip(entry, content.WorkspacePath, () =>
			{
				TrackArcAction("file_opened", new JsonObject
				{
					["via"] = "file_chip",
					["artifact_kind"] = ClickyAnalytics.ProductArtifactKind(entry)
				});
				dock.OpenCardFile(entry, content);
			}));
		}
		if (readOnlyList.Count > 3)
		{
			TextBlock textBlock2 = Ui.Text($"+{readOnlyList.Count - 3}", 17.0, FontWeights.SemiBold, ink.WithAlpha(0.5));
			textBlock2.VerticalAlignment = VerticalAlignment.Center;
			stackPanel.Children.Add(textBlock2);
		}
		yield return stackPanel;
	}

	private bool ShowsTourLine()
	{
		if (content.State == ArcCardState.Suggested)
		{
			return dock.Host.IsTourRunning();
		}
		return false;
	}

	private void BuildFooter()
	{
		footerProgress = null;
		footerShowsTourLine = ShowsTourLine();
		Grid grid = new Grid();
		grid.Children.Add(new Border
		{
			Background = Ui.Horizontal((0.0, ArcColors.TitleGreyEdge), (0.5, ArcColors.TitleGreyMiddle), (1.0, ArcColors.TitleGreyEdge))
		});
		if (footerWash.Parent is Panel panel)
		{
			panel.Children.Remove(footerWash);
		}
		grid.Children.Add(footerWash);
		grid.Children.Add(new Border
		{
			Height = 1.0,
			VerticalAlignment = VerticalAlignment.Top,
			Background = Ui.Brush(DS.Black(0.09))
		});
		FrameworkElement frameworkElement = null;
		if (content.IsWorking)
		{
			Grid grid2 = new Grid
			{
				ColumnSpacing = 12.0,
				Padding = new Thickness(22.0, CanStopWork ? 8 : 12, CanStopWork ? 14 : 22, CanStopWork ? 8 : 12)
			};
			grid2.ColumnDefinitions.Add(new ColumnDefinition
			{
				Width = new GridLength(1.0, GridUnitType.Star)
			});
			grid2.ColumnDefinitions.Add(new ColumnDefinition
			{
				Width = GridLength.Auto
			});
			footerProgress = new ArcProgressBar(content.Plan, content.Paper.Ink, isLarge: false)
			{
				VerticalAlignment = VerticalAlignment.Center
			};
			grid2.Children.Add(footerProgress);
			if (CanStopWork)
			{
				ArcStopButton arcStopButton = new ArcStopButton(() =>
				{
					TrackArcAction("stop");
					dock.StopWork(content);
				});
				Grid.SetColumn(arcStopButton, 1);
				grid2.Children.Add(arcStopButton);
			}
			frameworkElement = grid2;
		}
		else
		{
			CardFooterRequest request = content.Request;
			if ((object)request != null)
			{
				frameworkElement = new FooterRequestRow(dock, content, request, 34.0);
			}
			else if (footerShowsTourLine)
			{
				Color color = DS.Hex(3112182u);
				Grid grid3 = new Grid
				{
					ColumnSpacing = 7.0,
					MinHeight = 32.0,
					Padding = new Thickness(18.0, 9.0, 18.0, 9.0),
					ColumnDefinitions = 
					{
						new ColumnDefinition
						{
							Width = GridLength.Auto
						},
						new ColumnDefinition
						{
							Width = new GridLength(1.0, GridUnitType.Star)
						}
					}
				};
				FrameworkElement frameworkElement2 = ArcSymbols.Make("clock", 13.0, color);
				frameworkElement2.VerticalAlignment = VerticalAlignment.Center;
				grid3.Children.Add(frameworkElement2);
				FrameworkElement frameworkElement3 = Ui.Shrink(Ui.Text("Start it from your notch after the tour", 14.0, FontWeights.SemiBold, color), HorizontalAlignment.Left, 0.8);
				frameworkElement3.VerticalAlignment = VerticalAlignment.Center;
				Grid.SetColumn(frameworkElement3, 1);
				grid3.Children.Add(frameworkElement3);
				frameworkElement = grid3;
			}
			else if (content.State == ArcCardState.Suggested)
			{
				GelButton item = ArcButtons.Gel("Start now", "play.fill", GelAppearance.PrimaryBlue, 32.0, 13.5, GelButton.Sizing.Normal, () =>
				{
					TrackArcAction("start_now", new JsonObject { ["via"] = "button" });
					dock.OpenFullResponse(content);
				});
				frameworkElement = new StackPanel
				{
					Orientation = Orientation.Horizontal,
					Spacing = 8.0,
					Padding = new Thickness(16.0, 9.0, 16.0, 9.0),
					Children = { (UIElement)item }
				};
			}
			else if (content.IsDone || dock.CanShowFullResponse(content))
			{
				StackPanel stackPanel = new StackPanel
				{
					Orientation = Orientation.Horizontal,
					Spacing = 8.0,
					Padding = new Thickness(16.0, 9.0, 16.0, 9.0)
				};
				bool flag = (object)NextStepButton() != null;
				if (flag)
				{
					stackPanel.Children.Add(NextStepButton());
				}
				if (dock.CanShowFullResponse(content))
				{
					stackPanel.Children.Add(ArcButtons.Gel("Full report", "doc.text", flag ? GelAppearance.SecondaryWhite : GelAppearance.PrimaryBlue, 32.0, 13.5, GelButton.Sizing.Normal, () =>
					{
						OpenFullResponse("full_report_button");
					}));
				}
				frameworkElement = stackPanel;
			}
		}
		if ((object)frameworkElement == null)
		{
			footerHost.Child = null;
			return;
		}
		grid.Children.Add(frameworkElement);
		footerHost.Child = grid;
	}

	private FrameworkElement? NextStepButton()
	{
		ClickyAnswer clickyAnswer = (content.IsDone ? content.Answer : null);
		if (clickyAnswer?.Ask != null)
		{
			return ArcButtons.Gel("Type an answer", "keyboard", GelAppearance.SecondaryWhite, 32.0, 13.5, GelButton.Sizing.Normal, () =>
			{
				TrackArcAction("next_step", new JsonObject { ["kind"] = "type_answer" });
				dock.OpenInChat(content);
				dock.Host.RequestComposerFocus();
			});
		}
		ClickyAnswer.Draft draft = clickyAnswer?.DraftText;
		if ((object)draft != null)
		{
			return ArcButtons.Gel(isDraftCopied ? "Copy again" : "Copy", "doc.on.doc", GelAppearance.PrimaryBlue, 32.0, 13.5, GelButton.Sizing.Normal, () =>
			{
				TrackArcAction("next_step", new JsonObject
				{
					["kind"] = "copy",
					["is_repeat"] = isDraftCopied
				});
				dock.CopyDraft(content, draft.Text);
				isDraftCopied = true;
				face?.Update(isDraftCopied, sentChoice);
				BuildFooter();
			});
		}
		ClickyAnswer.NextStep next = clickyAnswer?.Next;
		if ((object)next != null)
		{
			bool isLink = next.Open.StartsWith("http", StringComparison.OrdinalIgnoreCase);
			return ArcButtons.Gel(next.Label, isLink ? "arrow.up.right" : null, GelAppearance.PrimaryBlue, 32.0, 13.5, GelButton.Sizing.Normal, () =>
			{
				TrackArcAction("next_step", new JsonObject { ["kind"] = (isLink ? "next_link" : "next_file") });
				dock.OpenResultCardTarget(next.Open, content);
			});
		}
		CardReadyOutput output = content.ReadyOutput;
		if ((object)output != null && (!output.OpensFullReplyOnly || !dock.CanShowFullResponse(content)))
		{
			string buttonTitle = output.ButtonTitle;
			string text = output.ButtonSymbol;
			if (text == null)
			{
				CardReadyOutput.Kinds kind = output.Kind;
				bool flag = ((kind == CardReadyOutput.Kinds.File || kind == CardReadyOutput.Kinds.Several) ? true : false);
				text = (flag ? output.Symbol : null);
			}
			return ArcButtons.Gel(buttonTitle, text, GelAppearance.PrimaryBlue, 32.0, 13.5, GelButton.Sizing.Normal, () =>
			{
				TrackArcAction("next_step", new JsonObject
				{
					["kind"] = "open_output",
					["output_kind"] = ArcDockAnalytics.OutputKind(output.Kind)
				});
				dock.OpenReadyOutput(content.RailKey, output);
			});
		}
		if ((object)clickyAnswer != null && clickyAnswer.IsQuiet)
		{
			string routineId = dock.ResultCardRoutineId(content);
			if (routineId != null)
			{
				return ArcButtons.Gel("Run it now", "arrow.clockwise", GelAppearance.SecondaryWhite, 32.0, 13.5, GelButton.Sizing.Normal, () =>
				{
					TrackArcAction("next_step", new JsonObject { ["kind"] = "run_now" });
					dock.RunRoutineNow(routineId);
				});
			}
		}
		return null;
	}

	private void BuildCover(bool animated)
	{
		coverProgress = null;
		bool flag = showsCover;
		SwiftSpring spring = new SwiftSpring(0.4, 0.82);
		contentStack.CenterPoint = new Vector3(240f, 133f, 0f);
		if (animated && !Anim.ReduceMotion)
		{
			Anim.ScaleSpring(contentStack, flag ? 0.97f : 1f, spring);
		}
		else
		{
			contentStack.Scale = (flag ? new Vector3(0.97f, 0.97f, 1f) : Vector3.One);
		}
		if (!flag)
		{
			if (coverHost.Children.Count == 0)
			{
				return;
			}
			if (!animated)
			{
				coverHost.Children.Clear();
				return;
			}
			List<UIElement> leaving = coverHost.Children.ToList();
			foreach (UIElement item in leaving.OfType<UIElement>())
			{
				Lift(item, off: true, spring);
			}
			DockTimer.After(0.45, () =>
			{
				if (!showsCover)
				{
					foreach (UIElement item2 in leaving)
					{
						coverHost.Children.Remove(item2);
					}
				}
			});
		}
		else
		{
			coverHost.Children.Clear();
			FrameworkElement frameworkElement = Cover();
			coverHost.Children.Add(frameworkElement);
			if (animated)
			{
				frameworkElement.Opacity = 0.0;
				frameworkElement.Scale = new Vector3(1.06f, 1.06f, 1f);
				frameworkElement.Translation = new Vector3(0f, -14f, 0f);
				Lift(frameworkElement, off: false, spring);
			}
		}
	}

	private static void Lift(UIElement e, bool off, SwiftSpring spring)
	{
		e.CenterPoint = new Vector3(240f, 133f, 0f);
		if (Anim.ReduceMotion)
		{
			Anim.Opacity(e, (!off) ? 1 : 0, 0.18);
			return;
		}
		Anim.OpacitySpring(e, (!off) ? 1 : 0, spring);
		Anim.ScaleSpring(e, off ? 1.06f : 1f, spring);
		Anim.TranslationSpring(e, new Vector3(0f, off ? (-14) : 0, 0f), spring);
	}

	private FrameworkElement Cover()
	{
		Grid grid = new Grid();
		grid.Children.Add(new Border
		{
			Background = Ui.Brush(content.Paper.Fill),
			Opacity = 0.95
		});
		grid.Children.Add(new Grid
		{
			Opacity = 0.95,
			Children = { (UIElement)ArcPaperTexture.Create() }
		});
		FirstThatFits firstThatFits = new FirstThatFits
		{
			Margin = new Thickness(30.0, 20.0, 30.0, 20.0),
			VerticalAlignment = VerticalAlignment.Center
		};
		(double, double)[] array = ArcCover.LevelsFor(content.State);
		(double, double)[] array2 = array;
		foreach ((double, double) level in array2)
		{
			firstThatFits.Children.Add(CoverStack(level));
		}
		firstThatFits.Children.Add(new ShrinkToFit(CoverStack(array[^1]), 0.6));
		grid.Children.Add(firstThatFits);
		string text = (content.IsFinalizing ? "Finalizing" : ArcCover.Title(content.State));
		AutomationProperties.SetName(grid, text + ". " + content.Title);
		return grid;
	}

	private FrameworkElement CoverStack((double State, double Title) level)
	{
		bool flag = ArcCover.IsQuiet(content.State);
		StackPanel stackPanel = new StackPanel
		{
			Spacing = 10.0,
			VerticalAlignment = VerticalAlignment.Center
		};
		double num;
		if (!flag)
		{
			(num, _) = level;
		}
		else
		{
			num = 24.0;
		}
		double num2 = num;
		Color color = ArcColors.State(content.State);
		StackPanel stackPanel2 = new StackPanel
		{
			Orientation = Orientation.Horizontal,
			Spacing = num2 * 0.28,
			HorizontalAlignment = HorizontalAlignment.Center
		};
		string text = ArcCover.Symbol(content.State);
		if (text != null)
		{
			stackPanel2.Children.Add(ArcSymbols.Make(text, num2 * 0.72, color));
		}
		TextBlock textBlock = Ui.Text(content.IsFinalizing ? "Finalizing" : ArcCover.Title(content.State), num2, FontWeights.ExtraBold, color);
		textBlock.FontFamily = DS.Fonts.Display;
		stackPanel2.Children.Add(Ui.Shrink(textBlock, HorizontalAlignment.Left, 0.6));
		stackPanel.Children.Add(stackPanel2);
		TextBlock textBlock2 = Ui.Text(content.Title, level.Title, FontWeights.ExtraBold, content.Paper.Ink.WithAlpha(flag ? 1.0 : 0.85), TextAlignment.Center, 0, wrap: true);
		textBlock2.FontFamily = DS.Fonts.Display;
		textBlock2.HorizontalAlignment = HorizontalAlignment.Center;
		stackPanel.Children.Add(textBlock2);
		if (content.IsWorking)
		{
			ClickyArcPlan? plan = content.Plan;
			Color ink = content.Paper.Ink;
			ClickyArcPlan plan2 = content.Plan;
			ArcProgressBar item = new ArcProgressBar(plan, ink, isLarge: true, (object)plan2 != null && !plan2.IsEmpty)
			{
				MaxWidth = 340.0,
				Margin = new Thickness(0.0, 8.0, 0.0, 0.0),
				HorizontalAlignment = HorizontalAlignment.Stretch
			};
			if ((object)coverProgress == null)
			{
				coverProgress = item;
			}
			stackPanel.Children.Add(item);
		}
		return stackPanel;
	}
}
