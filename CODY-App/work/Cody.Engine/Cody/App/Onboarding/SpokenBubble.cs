using System;
using HeyClicky.App.Design;
using HeyClicky.App.UI;
using Microsoft.UI;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.Foundation;

namespace HeyClicky.App.Onboarding;

public sealed class SpokenBubble : Grid
{
	private readonly Path fill;

	private readonly Path stroke;

	private const double Tail = 8.0;

	private const double StrokeWidth = 1.3;

	public SpokenBubble(string line)
	{
		HorizontalAlignment = HorizontalAlignment.Center;
		fill = new Path
		{
			Fill = Ui.Vertical((0.0, DS.Hex(16771542u)), (0.42, DS.Hex(16763289u)), (1.0, DS.Hex(16771542u)))
		};
		stroke = new Path
		{
			Fill = Ui.Vertical((0.0, DS.Hex(10114328u)), (1.0, DS.Hex(6447714u)))
		};
		Border item = new Border
		{
			Height = 8.0,
			Margin = new Thickness(16.0, 11.0, 16.0, 0.0),
			VerticalAlignment = VerticalAlignment.Top,
			CornerRadius = new CornerRadius(4.0),
			Background = Ui.Vertical((0.0, DS.White(0.85)), (1.0, DS.White(0.02))),
			IsHitTestVisible = false
		};
		Path item2 = Icons.PathIcon("M3,10 h2 v4 h-2 z M7,7 h2 v10 h-2 z M11,3 h2 v18 h-2 z M15,6 h2 v12 h-2 z M19,9 h2 v6 h-2 z", 11.0, Colors.Black);
		TextBlock ink = Ui.Text("“" + line + "”", 13.0, FontWeights.SemiBold, Colors.Black, TextAlignment.Center, 0, wrap: true);
		StackPanel stackPanel = new StackPanel
		{
			Orientation = Orientation.Horizontal,
			Spacing = 7.0,
			Margin = new Thickness(17.0, 18.0, 17.0, 10.0),
			VerticalAlignment = VerticalAlignment.Center
		};
		stackPanel.Children.Add(item2);
		stackPanel.Children.Add(Ui.Embossed(ink));
		Children.Add(new ShadowLayer(16.0, DS.Black(0.11), 5.0, 4.0)
		{
			Margin = new Thickness(0.0, 8.0, 0.0, 0.0)
		});
		Children.Add(stroke);
		Children.Add(fill);
		Children.Add(item);
		Children.Add(stackPanel);
		fill.Margin = new Thickness(1.3, 1.3, 0.0, 0.0);
		SizeChanged += (object _, SizeChangedEventArgs _) =>
		{
			if (!(ActualWidth < 32.0) && !(ActualHeight < 20.0))
			{
				stroke.Data = Shape(ActualWidth, ActualHeight, 8.0);
				fill.Data = Shape(ActualWidth - 2.6, ActualHeight - 2.6, 7.22);
			}
		};
	}

	private static Geometry Shape(double w, double h, double tailTop)
	{
		double num = h - tailTop;
		double r = Math.Min(16.0, Math.Min(num / 2.0, w / 2.0));
		double num2 = w / 2.0;
		PathFigure f = new PathFigure
		{
			StartPoint = new Point(r, tailTop),
			IsClosed = true,
			IsFilled = true
		};
		f.Segments = new PathSegmentCollection();
		Point last = new Point(num2 - 13.0, tailTop);
		L(num2 - 13.0, tailTop);
		C(num2 - 6.5, tailTop, num2 - 4.6, 4.2, num2 - 2.4, 1.6);
		C(num2 - 2.4 + 1.5999999999999999, -0.1333333333333333, num2 + 2.4 - 1.5999999999999999, -0.1333333333333333, num2 + 2.4, 1.6);
		C(num2 + 4.6, 4.2, num2 + 6.5, tailTop, num2 + 13.0, tailTop);
		L(w - r, tailTop);
		A(w, tailTop + r);
		L(w, h - r);
		A(w - r, h);
		L(r, h);
		A(0.0, h - r);
		L(0.0, tailTop + r);
		A(r, tailTop);
		return new PathGeometry
		{
			Figures = { f }
		};
		void A(double x, double y)
		{
			f.Segments.Add(new ArcSegment
			{
				Point = new Point(x, y),
				Size = new Size(r, r),
				SweepDirection = SweepDirection.Clockwise
			});
		}
		void C(double x1, double y1, double x2, double y2, double x, double y)
		{
			Point point = last;
			for (int i = 1; i <= 10; i++)
			{
				double num3 = (double)i / 10.0;
				double num4 = 1.0 - num3;
				double x3 = num4 * num4 * num4 * point.X + 3.0 * num4 * num4 * num3 * x1 + 3.0 * num4 * num3 * num3 * x2 + num3 * num3 * num3 * x;
				double y3 = num4 * num4 * num4 * point.Y + 3.0 * num4 * num4 * num3 * y1 + 3.0 * num4 * num3 * num3 * y2 + num3 * num3 * num3 * y;
				f.Segments.Add(new LineSegment
				{
					Point = new Point(x3, y3)
				});
			}
			last = new Point(x, y);
		}
		void L(double x, double y)
		{
			f.Segments.Add(new LineSegment
			{
				Point = new Point(x, y)
			});
		}
	}
}
