namespace HeyClicky.App.Cody;

internal static class CodyDrawingControlState
{
    internal static bool IsDrawable(string kind)
        => kind is "Shape" or "Text" or "Wash" or "Dot" or "Window" or "Photo";
    // A computer-use stream can render target/window/photo UI without actually
    // drawing ink. Do not offer Clear for those non-annotation visuals.
    internal static bool HasContent(bool showing,bool faded,int renderedUnits,int models,int inkedMarks)
        => showing&&!faded&&(models>0||(inkedMarks>0&&renderedUnits>0));
}
