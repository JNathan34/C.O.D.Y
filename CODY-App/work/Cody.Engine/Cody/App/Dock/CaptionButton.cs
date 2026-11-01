using System.Linq;
using HeyClicky.App.Design;
using HeyClicky.App.UI;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.Foundation;
using Windows.UI;

namespace HeyClicky.App.Dock;

public sealed class CaptionButton : Pressable
{
	public enum Kind
	{
		Close,
		Maximize,
		Restore
	}

	public const double ButtonWidth = 46.0;

	private const double GlyphSize = 10.0;

	private static readonly Color CloseRed = DS.Hex(12856092u);

	private readonly Kind kind;

	private readonly Border plate;

	private readonly Path glyph;

	private readonly Brush restInk;

	private readonly Brush hoverInk;

	public Kind ButtonKind => kind;

	public CaptionButton(Kind kind, double height, Color ink, string help)
		: base(handCursor: false)
	{
		this.kind = kind;
		ProtectedCursor = Pressable.ArrowCursor;
		Width = 46.0;
		Height = height;
		restInk = Ui.Brush(ink);
		hoverInk = Ui.Brush((kind == Kind.Close) ? Colors.White : ink);
		plate = new Border
		{
			Background = Ui.Brush((kind == Kind.Close) ? CloseRed : Colors.Black),
			Opacity = 0.0,
			IsHitTestVisible = false
		};
		Children.Add(plate);
		glyph = new Path
		{
			Data = Glyph(kind),
			Stroke = restInk,
			StrokeThickness = 1.0,
			Width = 10.0,
			Height = 10.0,
			HorizontalAlignment = HorizontalAlignment.Center,
			VerticalAlignment = VerticalAlignment.Center,
			IsHitTestVisible = false
		};
		Children.Add(glyph);
		HoverChanged += (bool _) =>
		{
			ApplyLook();
		};
		PressedChanged += (bool _) =>
		{
			ApplyLook();
		};
		ToolTipService.SetToolTip(this, help);
		AutomationProperties.SetName(this, help);
	}

	private static Geometry Glyph(Kind kind)
	{
		PathGeometry geometry = new PathGeometry();
		switch (kind)
		{
		case Kind.Close:
			Lines(closed: false, new (double, double)[2]
			{
				(0.0, 0.0),
				(10.0, 10.0)
			});
			Lines(closed: false, new (double, double)[2]
			{
				(0.0, 10.0),
				(10.0, 0.0)
			});
			break;
		case Kind.Maximize:
			Lines(closed: true, new (double, double)[4]
			{
				(0.5, 0.5),
				(9.5, 0.5),
				(9.5, 9.5),
				(0.5, 9.5)
			});
			break;
		default:
			Lines(closed: true, new (double, double)[4]
			{
				(0.5, 2.5),
				(7.5, 2.5),
				(7.5, 9.5),
				(0.5, 9.5)
			});
			Lines(closed: false, new (double, double)[5]
			{
				(2.5, 2.5),
				(2.5, 0.5),
				(9.5, 0.5),
				(9.5, 7.5),
				(7.5, 7.5)
			});
			break;
		}
		return geometry;
		void Lines(bool closed, (double X, double Y)[] points)
		{
			PathFigure pathFigure = new PathFigure
			{
				StartPoint = new Point(points[0].X, points[0].Y),
				IsClosed = closed
			};
			foreach (var (x, y) in points.Skip(1))
			{
				pathFigure.Segments.Add(new LineSegment
				{
					Point = new Point(x, y)
				});
			}
			geometry.Figures.Add(pathFigure);
		}
	}

	private void ApplyLook()
	{
		bool flag = IsHovered || IsPressed;
		Border border = plate;
		double opacity;
		if (flag)
		{
			if (kind != Kind.Close)
			{
				opacity = (IsPressed ? 0.04 : 0.06);
			}
			else
			{
				opacity = (IsPressed ? 0.9 : 1.0);
			}
		}
		else
		{
			opacity = 0.0;
		}
		border.Opacity = opacity;
		glyph.Stroke = (flag ? hoverInk : restInk);
		glyph.Opacity = (IsPressed ? 0.7 : 1.0);
	}
}
