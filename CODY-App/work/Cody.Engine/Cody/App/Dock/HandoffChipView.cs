using HeyClicky.App.Drive;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;

namespace HeyClicky.App.Dock;

public sealed class HandoffChipView : Grid
{
	public HandoffChipView(HandoffGlyph glyph, string railKey, double size = 32.0)
	{
		HandoffChipView handoffChipView = this;
		Width = (Height = size);
		IsHitTestVisible = false;
		ArcPaper paper = new ArcPaper(NotePaperColors.Stock(NotePaperColors.Key(railKey)));
		int seed = NotePaperColors.Seed(railKey);
		double frame = size * 1.5;
		Loaded += (object _, RoutedEventArgs _) =>
		{
			double num2 = handoffChipView.XamlRoot?.RasterizationScale ?? 1.0;
			WriteableBitmap writeableBitmap = DriveArt.HandoffChip(HandoffGlyphs.Path(glyph), paper.TitleWash, paper.Deep, size, frame, num2 * 2.0, seed);
			if ((object)writeableBitmap != null)
			{
				handoffChipView.Children.Add(new Image
				{
					Source = writeableBitmap,
					Width = frame,
					Height = frame,
					Margin = new Thickness((0.0 - (frame - size)) / 2.0),
					Stretch = Stretch.Fill
				});
			}
		};
	}
}
