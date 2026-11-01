namespace HeyClicky.Platform.Overlay;

internal readonly struct OverlayFrame(double timeSeconds, double deltaSeconds, PointD mousePx)
{
	public readonly double TimeSeconds = timeSeconds;

	public readonly double DeltaSeconds = deltaSeconds;

	public readonly PointD MousePx = mousePx;
}
