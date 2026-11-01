using System;
using System.Numerics;
using HeyClicky.App.Design;
using HeyClicky.App.UI;
using Microsoft.UI.Composition;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Hosting;
using Microsoft.UI.Xaml.Media;
using Windows.UI;

namespace HeyClicky.App.Dock;

public sealed class BreathingText : Grid
{
	private const double PassSeconds = 1.7;

	private readonly TextBlock rest;

	private readonly TextBlock light;

	private readonly bool breathes;

	private SpriteVisual? band;

	private CompositionLinearGradientBrush? gradient;

	public BreathingText(string text, double fontSize, Color restColor, Color lightColor, bool breathes)
	{
		this.breathes = breathes;
		IsHitTestVisible = false;
		rest = Ui.Text(text, fontSize, FontWeights.Medium, restColor);
		light = Ui.Text(text, fontSize, FontWeights.Medium, lightColor);
		light.Opacity = 0.0;
		Children.Add(rest);
		Children.Add(light);
		if (breathes)
		{
			Loaded += (object _, RoutedEventArgs _) =>
			{
				Build();
			};
			SizeChanged += (object _, SizeChangedEventArgs _) =>
			{
				Rebuild();
			};
		}
	}

	private void Build()
	{
		if ((object)band == null)
		{
			Compositor compositor = Ui.Compositor;
			CompositionBrush alphaMask = light.GetAlphaMask();
			gradient = compositor.CreateLinearGradientBrush();
			gradient.MappingMode = CompositionMappingMode.Absolute;
			CompositionMaskBrush compositionMaskBrush = compositor.CreateMaskBrush();
			compositionMaskBrush.Source = gradient;
			compositionMaskBrush.Mask = alphaMask;
			band = compositor.CreateSpriteVisual();
			band.Brush = compositionMaskBrush;
			ElementCompositionPreview.SetElementChildVisual(this, band);
			Rebuild();
		}
	}

	private void Rebuild()
	{
		if ((object)band != null && (object)gradient != null)
		{
			float num = (float)ActualWidth;
			float num2 = (float)ActualHeight;
			if (!(num <= 0f) && !(num2 <= 0f))
			{
				band.Size = new Vector2(num, num2);
				Compositor compositor = Ui.Compositor;
				Color color = ((SolidColorBrush)light.Foreground).Color;
				gradient.ColorStops.Clear();
				gradient.ColorStops.Add(compositor.CreateColorGradientStop(0f, Color.FromArgb(0, color.R, color.G, color.B)));
				gradient.ColorStops.Add(compositor.CreateColorGradientStop(0.5f, color));
				gradient.ColorStops.Add(compositor.CreateColorGradientStop(1f, Color.FromArgb(0, color.R, color.G, color.B)));
				gradient.StartPoint = new Vector2(-0.45f * num, 0f);
				gradient.EndPoint = new Vector2(0f, 0f);
				Vector2KeyFrameAnimation vector2KeyFrameAnimation = compositor.CreateVector2KeyFrameAnimation();
				vector2KeyFrameAnimation.InsertKeyFrame(0f, Vector2.Zero);
				vector2KeyFrameAnimation.InsertKeyFrame(1f, new Vector2(1.45f * num, 0f), Easing.EaseInOut(compositor));
				vector2KeyFrameAnimation.Duration = TimeSpan.FromSeconds(1.7);
				vector2KeyFrameAnimation.Direction = AnimationDirection.Alternate;
				vector2KeyFrameAnimation.IterationBehavior = AnimationIterationBehavior.Forever;
				gradient.StartAnimation("Offset", vector2KeyFrameAnimation);
			}
		}
	}
}
