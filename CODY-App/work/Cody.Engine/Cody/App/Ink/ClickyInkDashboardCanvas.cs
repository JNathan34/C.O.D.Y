using System;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.Foundation;

namespace HeyClicky.App.Ink;

public sealed class ClickyInkDashboardCanvas : Panel
{
	private readonly Action<PaperDrawing, Size> draw;

	private readonly PaperDrawing drawing = new PaperDrawing();

	private readonly bool clips;

	private Size drawnAt;

	private bool hasDrawn;

	public ClickyInkDashboardCanvas(Action<PaperDrawing, Size> draw, double? width = null, double? height = null, bool clips = true)
	{
		this.draw = draw;
		this.clips = clips;
		IsHitTestVisible = false;
		if (width.HasValue)
		{
			double valueOrDefault = width.GetValueOrDefault();
			Width = Math.Max(0.0, valueOrDefault);
		}
		if (height.HasValue)
		{
			double valueOrDefault2 = height.GetValueOrDefault();
			Height = Math.Max(0.0, valueOrDefault2);
		}
		Children.Add(drawing);
		if (!double.IsNaN(Width) && !double.IsNaN(Height))
		{
			Redraw(new Size(Width, Height));
		}
	}

	protected override Size MeasureOverride(Size availableSize)
	{
		drawing.Measure(new Size(0f, 0f));
		double width;
		if (double.IsNaN(Width))
		{
			width = (double.IsInfinity(availableSize.Width) ? 0.0 : availableSize.Width);
		}
		else
		{
			width = Width;
		}
		double height;
		if (double.IsNaN(Height))
		{
			height = (double.IsInfinity(availableSize.Height) ? 0.0 : availableSize.Height);
		}
		else
		{
			height = Height;
		}
		return new Size(width, height);
	}

	protected override Size ArrangeOverride(Size finalSize)
	{
		drawing.Arrange(new Rect(0.0, 0.0, finalSize.Width, finalSize.Height));
		if (!hasDrawn || Math.Abs(finalSize.Width - drawnAt.Width) > 0.01 || Math.Abs(finalSize.Height - drawnAt.Height) > 0.01)
		{
			Redraw(finalSize);
		}
		return finalSize;
	}

	private void Redraw(Size size)
	{
		drawnAt = size;
		hasDrawn = true;
		drawing.Children.Clear();
		Clip = (clips ? new RectangleGeometry
		{
			Rect = new Rect(0.0, 0.0, size.Width, size.Height)
		} : null);
		if (!(size.Width <= 0.0) && !(size.Height <= 0.0))
		{
			draw(drawing, size);
		}
	}

	public static void DrawText(PaperDrawing drawing, TextBlock text, Point center)
	{
		text.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
		Canvas.SetLeft(text, center.X - text.DesiredSize.Width / 2.0);
		Canvas.SetTop(text, center.Y - text.DesiredSize.Height / 2.0);
		drawing.Children.Add(text);
	}
}
