using System;
using System.Linq;
using System.Numerics;
using HeyClicky.App.Design;
using HeyClicky.App.Shell;
using HeyClicky.App.UI;
using HeyClicky.Core.Drive;
using Microsoft.Graphics.Canvas;
using Microsoft.UI;
using Microsoft.UI.Composition;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Hosting;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Foundation;
using Windows.UI;

namespace HeyClicky.App.Drive;

public sealed class TakeOverConsentCard
{
	private sealed class DispatcherQueueTimerHandle(DispatcherQueueTimer timer)
	{
		public void Stop()
		{
			timer.Stop();
		}
	}

	private OverlayWindow? window;

	private DispatcherQueueTimerHandle? timeout;

	private int generation;

	private Action? acceptForTest;
	private string codyApprovalId;

	public bool IsShown => HeyClicky.App.Cody.CodyEngineBridge.Consent.Contains(codyApprovalId) || (window?.IsShown ?? false);

	internal void AcceptForTest()
	{
		if (IsShown)
		{
			acceptForTest?.Invoke();
		}
	}

	public void Present(string goal, string? line, Color accent, Action onAccept, Action onDecline, Action<string, double>? playChime = null, Action? onTimedOut = null)
	{
		Dismiss(animated: false);
		if(HeyClicky.App.Cody.CodyEngineBridge.EngineMode){
            codyApprovalId=HeyClicky.App.Cody.CodyEngineBridge.Consent.Request("takeover-card",line??"Allow C.O.D.Y. to control your computer?",goal,
                allowed=>{codyApprovalId=null;if(allowed)onAccept();else onDecline();},
                timeout:TimeSpan.FromSeconds(45),timedOut:()=>{codyApprovalId=null;(onTimedOut??onDecline)();});
            if(codyApprovalId!=null)playChime?.Invoke("agent-needs-you",0.5);return;
        }
		int presentGeneration = ++generation;
		Displays.Monitor monitor = Displays.UnderCursor();
		double scale = monitor.Scale;
		double num = Math.Max(360.0, 500.0);
		double num2 = 8.0;
		double num3 = num - 60.0 - 42.0;
		object obj;
		if (line != null)
		{
			string text = ClickyDriveLines.Sentence(line);
			obj = ((text != null && text.Length > 0) ? text : null);
		}
		else
		{
			obj = null;
		}
		string text2 = (string)obj;
		TextBlock textBlock = Ui.Text(text2 ?? ClickyDriveLines.Brief(goal), (text2 == null) ? 11 : 14, (text2 == null) ? FontWeights.Normal : FontWeights.SemiBold, Colors.White, TextAlignment.Left, 0, wrap: true);
		textBlock.Measure(new Size(num3, double.PositiveInfinity));
		double height = textBlock.DesiredSize.Height;
		double num4 = num2 + (double)((text2 != null) ? ((height > 20.0) ? 128 : 110) : ((height > 16.0) ? 138 : 124));
		if ((object)window == null)
		{
			window = new OverlayWindow("HeyClicky drive", excludeFromCapture: true, clickThroughEverywhere: false, activatable: false, topmost: true, showInTaskbar: false, alwaysExcludedFromCapture: true);
		}
		int x = monitor.Bounds.Left + (int)Math.Round(((double)monitor.Bounds.Width - num * scale) / 2.0);
		window.PlacePx(x, monitor.Bounds.Top, (int)Math.Ceiling(num * scale), (int)Math.Ceiling((num4 + 30.0) * scale));
		window.SetRegionPx(0, 0, (int)Math.Ceiling(num * scale), (int)Math.Ceiling((num4 + 30.0) * scale));
		Grid grid = new Grid
		{
			Width = num,
			Height = num4 + 30.0,
			VerticalAlignment = VerticalAlignment.Top
		};
		Grid grid2 = new Grid
		{
			Width = num,
			Height = num4,
			VerticalAlignment = VerticalAlignment.Top
		};
		grid.Children.Add(grid2);
		Compositor compositor = Ui.Compositor;
		CompositionPath path = new CompositionPath(DriveArt.NotchAttachedPath(CanvasDevice.GetSharedDevice(), num, num4, 26.0));
		ShapeVisual shapeVisual = compositor.CreateShapeVisual();
		shapeVisual.Size = new Vector2((float)num, (float)num4);
		CompositionSpriteShape compositionSpriteShape = compositor.CreateSpriteShape(compositor.CreatePathGeometry(path));
		compositionSpriteShape.FillBrush = compositor.CreateColorBrush(Colors.Black);
		shapeVisual.Shapes.Add(compositionSpriteShape);
		ShapeVisual shapeVisual2 = compositor.CreateShapeVisual();
		shapeVisual2.Size = shapeVisual.Size;
		CompositionSpriteShape compositionSpriteShape2 = compositor.CreateSpriteShape(compositor.CreatePathGeometry(path));
		compositionSpriteShape2.FillBrush = compositor.CreateColorBrush(Colors.Black);
		shapeVisual2.Shapes.Add(compositionSpriteShape2);
		CompositionVisualSurface compositionVisualSurface = compositor.CreateVisualSurface();
		compositionVisualSurface.SourceVisual = shapeVisual2;
		compositionVisualSurface.SourceSize = shapeVisual.Size;
		CompositionSurfaceBrush compositionSurfaceBrush = compositor.CreateSurfaceBrush(compositionVisualSurface);
		compositionSurfaceBrush.Stretch = CompositionStretch.None;
		DropShadow dropShadow = compositor.CreateDropShadow();
		dropShadow.Color = DS.Black(0.45);
		dropShadow.BlurRadius = 36f;
		dropShadow.Offset = new Vector3(0f, 8f, 0f);
		dropShadow.Mask = compositionSurfaceBrush;
		SpriteVisual spriteVisual = compositor.CreateSpriteVisual();
		spriteVisual.Size = shapeVisual.Size;
		spriteVisual.Shadow = dropShadow;
		ContainerVisual containerVisual = compositor.CreateContainerVisual();
		containerVisual.Size = shapeVisual.Size;
		containerVisual.Children.InsertAtTop(spriteVisual);
		containerVisual.Children.InsertAtTop(shapeVisual);
		Grid grid3 = new Grid();
		ElementCompositionPreview.SetElementChildVisual(grid3, containerVisual);
		grid2.Children.Add(grid3);
		Image item = new Image
		{
			Width = 44.0,
			Height = 44.0,
			Margin = new Thickness(-6.0),
			Source = DriveArt.DriveChip(32.0, 44.0, scale),
			VerticalAlignment = VerticalAlignment.Top
		};
		TextBlock textBlock2 = Ui.Text(text2 ?? "Want me to do it?", 14.0, FontWeights.SemiBold, DS.White(0.95), TextAlignment.Left, 2);
		textBlock2.TextWrapping = TextWrapping.WrapWholeWords;
		(WriteableBitmap? Image, double Width, double Height) tuple = DriveArt.Stamp("YOU", DriveArt.NeedsYouOnBlack, 7.5, scale);
		WriteableBitmap item2 = tuple.Image;
		double item3 = tuple.Width;
		double item4 = tuple.Height;
		Image image = new Image
		{
			Source = item2,
			Width = item3,
			Height = item4,
			Opacity = 0.92,
			VerticalAlignment = VerticalAlignment.Top,
			Rotation = -5f,
			CenterPoint = new Vector3((float)item3 / 2f, (float)item4 / 2f, 0f)
		};
		Grid grid4 = new Grid
		{
			ColumnSpacing = 8.0
		};
		grid4.ColumnDefinitions.Add(new ColumnDefinition
		{
			Width = new GridLength(1.0, GridUnitType.Auto)
		});
		grid4.ColumnDefinitions.Add(new ColumnDefinition
		{
			Width = new GridLength(1.0, GridUnitType.Star)
		});
		grid4.Children.Add(textBlock2);
		Grid.SetColumn(image, 1);
		image.HorizontalAlignment = HorizontalAlignment.Left;
		grid4.Children.Add(image);
		textBlock2.MaxWidth = num3 - item3 - 8.0;
		StackPanel stackPanel = new StackPanel
		{
			Spacing = 3.0
		};
		stackPanel.Children.Add(grid4);
		if (text2 == null)
		{
			TextBlock item5 = Ui.Text(ClickyDriveLines.Brief(goal), 11.0, FontWeights.Normal, DS.White(0.62), TextAlignment.Left, 2);
			stackPanel.Children.Add(item5);
		}
		stackPanel.Children.Add(Ui.Text("You watch. Esc takes it back.", 11.0, FontWeights.Normal, DS.White(0.42)));
		Grid grid5 = new Grid
		{
			ColumnSpacing = 10.0
		};
		grid5.ColumnDefinitions.Add(new ColumnDefinition
		{
			Width = GridLength.Auto
		});
		grid5.ColumnDefinitions.Add(new ColumnDefinition
		{
			Width = new GridLength(1.0, GridUnitType.Star)
		});
		grid5.Children.Add(item);
		Grid.SetColumn(stackPanel, 1);
		grid5.Children.Add(stackPanel);
		GelButton gelButton = new GelButton("Go ahead", GelAppearance.PrimaryBlue, GelButton.Sizing.Normal, 100.0, null, 13.0, 34.0);
		GelButton gelButton2 = new GelButton("Not now", GelAppearance.SecondaryWhite, GelButton.Sizing.Normal, 100.0, null, 13.0, 34.0);
		StackPanel stackPanel2 = new StackPanel
		{
			Orientation = Orientation.Horizontal,
			Spacing = 8.0,
			Margin = new Thickness(42.0, 0.0, 0.0, 0.0)
		};
		stackPanel2.Children.Add(gelButton);
		stackPanel2.Children.Add(gelButton2);
		StackPanel stackPanel3 = new StackPanel
		{
			Spacing = 9.0,
			VerticalAlignment = VerticalAlignment.Top,
			Margin = new Thickness(30.0, num2 + 10.0, 30.0, 0.0)
		};
		stackPanel3.Children.Add(grid5);
		stackPanel3.Children.Add(stackPanel2);
		grid2.Children.Add(stackPanel3);
		bool answered = false;
		gelButton.Click += Accept;
		acceptForTest = Accept;
		gelButton2.Click += () =>
		{
			if (!answered)
			{
				answered = true;
				Dismiss();
				onDecline();
			}
		};
		window.Root.Children.Clear();
		window.Root.Children.Add(grid);
		window.ShowNoActivate();
		playChime?.Invoke("agent-needs-you", 0.5);
		SwiftSpring spring = new SwiftSpring(0.42, 0.78);
		grid2.CenterPoint = new Vector3((float)num / 2f, 0f, 0f);
		stackPanel3.Opacity = 0.0;
		if (Anim.ReduceMotion)
		{
			Anim.OpacitySpring(stackPanel3, 1f, spring);
		}
		else
		{
			grid2.Scale = new Vector3(0.4f, 0.2f, 1f);
			SpringVector3NaturalMotionAnimation springVector3NaturalMotionAnimation = spring.Vector3(compositor, Vector3.One);
			springVector3NaturalMotionAnimation.Target = "Scale";
			grid2.StartAnimation(springVector3NaturalMotionAnimation);
			Anim.OpacitySpring(stackPanel3, 1f, spring);
		}
		DispatcherQueueTimer dispatcherQueueTimer = window.DispatcherQueue.CreateTimer();
		dispatcherQueueTimer.Interval = TimeSpan.FromSeconds(45L);
		dispatcherQueueTimer.IsRepeating = false;
		dispatcherQueueTimer.Tick += (DispatcherQueueTimer _, object _) =>
		{
			if (!((generation != presentGeneration) | answered))
			{
				OverlayWindow? overlayWindow = window;
				if ((object)overlayWindow != null && overlayWindow.IsShown)
				{
					answered = true;
					Dismiss();
					(onTimedOut ?? onDecline)();
				}
			}
		};
		dispatcherQueueTimer.Start();
		timeout = new DispatcherQueueTimerHandle(dispatcherQueueTimer);
		void Accept()
		{
			if (!answered)
			{
				answered = true;
				Dismiss(animated: false);
				onAccept();
			}
		}
	}

	public void Dismiss(bool animated = true)
	{
        HeyClicky.App.Cody.CodyEngineBridge.Consent.Remove(codyApprovalId);codyApprovalId=null;
		timeout?.Stop();
		timeout = null;
		if ((object)window == null || !window.IsShown)
		{
			return;
		}
		int dismissGeneration = ++generation;
		OverlayWindow closing = window;
		if (!animated)
		{
			closing.HideWindow();
			closing.Root.Children.Clear();
			return;
		}
		UIElement uIElement = closing.Root.Children.FirstOrDefault();
		if ((object)uIElement != null)
		{
			Anim.Opacity(uIElement, 0f, 0.18);
		}
		DispatcherQueueTimer dispatcherQueueTimer = closing.DispatcherQueue.CreateTimer();
		dispatcherQueueTimer.Interval = TimeSpan.FromSeconds(0.18);
		dispatcherQueueTimer.IsRepeating = false;
		dispatcherQueueTimer.Tick += (DispatcherQueueTimer _, object _) =>
		{
			if (generation == dismissGeneration)
			{
				closing.HideWindow();
				closing.Root.Children.Clear();
			}
		};
		dispatcherQueueTimer.Start();
	}
}
