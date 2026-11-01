using System;
using System.Numerics;
using HeyClicky.App.Design;
using HeyClicky.App.Shell;
using HeyClicky.App.UI;
using Microsoft.UI.Composition;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.Foundation;

namespace HeyClicky.App.Billing;

public sealed class PaywallWindow : OverlayWindow
{
	private const double ShadowMargin = 32.0;

	private readonly Grid stage;

	private readonly Border chrome;

	private readonly ShadowLayer shadow;

	private double cardWidth;

	private Displays.Monitor monitor;

	private int generation;

	public bool IsShowing { get; private set; }

	public UIElement? Card => chrome.Child;

	public PaywallWindow(bool excludeFromCapture)
		: base("HeyClicky", excludeFromCapture)
	{
		stage = new Grid
		{
			Margin = new Thickness(32.0),
			HorizontalAlignment = HorizontalAlignment.Left,
			VerticalAlignment = VerticalAlignment.Top
		};
		shadow = new ShadowLayer(18.0, DS.Black(0.45), 16.0, 10.0);
		chrome = new Border
		{
			CornerRadius = new CornerRadius(18.0),
			BorderThickness = new Thickness(0.5),
			Padding = new Thickness(28.0, 26.0, 28.0, 26.0)
		};
		stage.Children.Add(shadow);
		stage.Children.Add(chrome);
		Root.Children.Add(stage);
		MoveByBackground(chrome);
	}

	public void Present(PaywallCard card, double width, PaywallPalette palette)
	{
		generation++;
		cardWidth = width - 16.0;
		chrome.Background = Ui.Brush(palette.CardSurface);
		chrome.BorderBrush = Ui.Brush(palette.CardBorder);
		Root.RequestedTheme = ((!palette.IsDark) ? ElementTheme.Light : ElementTheme.Dark);
		chrome.Child = card;
		chrome.Width = cardWidth;
		shadow.Width = cardWidth;
		monitor = Displays.UnderCursor();
		Fit();
		bool isShowing = IsShowing;
		IsShowing = true;
		Anim.Stop(Root, "Opacity");
		Root.Opacity = 1.0;
		ShowNoActivate();
		Vector3 vector = new Vector3((float)(cardWidth / 2.0), (float)(MeasuredHeight() / 2.0), 0f);
		SwiftSpring spring = new SwiftSpring(0.35, 0.82);
		int num;
		if (isShowing)
		{
			num = ((stage.Opacity < 1.0) ? 1 : 0);
			if (num == 0)
			{
				goto IL_0149;
			}
		}
		else
		{
			num = 1;
		}
		stage.CenterPoint = vector;
		goto IL_0149;
		IL_0149:
		if (num != 0 && !Anim.Instant)
		{
			stage.Opacity = 0.0;
			Anim.ScaleUpFrom(stage, 0.94f, spring, vector);
		}
		else
		{
			Anim.ScaleSpring(stage, 1f, spring, vector);
		}
		Anim.OpacitySpring(stage, 1f, spring);
	}

	private double MeasuredHeight()
	{
		chrome.Height = double.NaN;
		chrome.Measure(new Size(cardWidth, double.PositiveInfinity));
		return Math.Ceiling(chrome.DesiredSize.Height);
	}

	public void Fit()
	{
		double num = MeasuredHeight();
		shadow.Height = num;
		chrome.Height = num;
		double num2 = cardWidth + 64.0;
		double num3 = num + 64.0;
		int num4 = (int)Math.Round(num2 * monitor.Scale);
		int num5 = (int)Math.Round(num3 * monitor.Scale);
		int x = monitor.Bounds.Left + (monitor.Bounds.Width - num4) / 2;
		int y = monitor.Bounds.Top + (monitor.Bounds.Height - num5) / 2;
		PlacePx(x, y, num4, num5);
	}

	public void Dismiss()
	{
		if (!IsShowing)
		{
			return;
		}
		IsShowing = false;
		int dismissGeneration = ++generation;
		CubicBezierEasingFunction easing = Easing.EaseOut(Ui.Compositor);
		Anim.Opacity(stage, 0f, 0.4, easing);
		Anim.Scale(stage, 0.96f, 0.4, easing, new Vector3((float)(cardWidth / 2.0), (float)(chrome.ActualHeight / 2.0), 0f));
		Anim.Opacity(Root, 0f, 0.45, easing);
		DispatcherQueueTimer dispatcherQueueTimer = DispatcherQueue.CreateTimer().Rooted();
		dispatcherQueueTimer.Interval = TimeSpan.FromSeconds(Anim.Instant ? 0.0 : 0.48);
		dispatcherQueueTimer.IsRepeating = false;
		dispatcherQueueTimer.Tick += (DispatcherQueueTimer _, object _) =>
		{
			if (generation == dismissGeneration && !IsShowing)
			{
				chrome.Child = null;
				HideWindow();
				Anim.Stop(Root, "Opacity");
				Root.Opacity = 1.0;
			}
		};
		dispatcherQueueTimer.Start();
	}
}
