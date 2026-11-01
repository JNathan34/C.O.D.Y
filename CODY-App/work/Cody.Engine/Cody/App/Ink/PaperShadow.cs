using Windows.UI;

namespace HeyClicky.App.Ink;

public sealed record PaperShadow(Color Color, double Radius, double X = 0.0, double Y = 0.0)
{
	public const double SigmaPerRadius = 0.5;
}
