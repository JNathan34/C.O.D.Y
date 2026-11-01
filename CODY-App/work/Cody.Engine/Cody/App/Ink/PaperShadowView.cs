using Microsoft.UI;
using Microsoft.UI.Xaml.Controls;

namespace HeyClicky.App.Ink;

public sealed class PaperShadowView : Grid
{
	private readonly PaperSurface surface;

	public PaperShadowView(IClickyShape shape, params PaperShadow[] shadows)
	{
		IsHitTestVisible = false;
		surface = new PaperSurface(shape, PaperFill.Of(Colors.Transparent));
		surface.Shadows.AddRange(shadows);
		Children.Add(surface);
	}
}
