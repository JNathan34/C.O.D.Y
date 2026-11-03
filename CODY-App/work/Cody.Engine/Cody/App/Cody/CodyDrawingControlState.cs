namespace HeyClicky.App.Cody;

internal static class CodyDrawingControlState
{
    internal static bool IsDrawable(string kind)
        => kind is "Shape" or "Text" or "Wash" or "Dot" or "Window" or "Photo";
    // An open stream, narration or an allocated transparent canvas is not a drawing.
    internal static bool HasContent(bool showing,bool faded,int renderedUnits,int models)
        => showing&&!faded&&(renderedUnits>0||models>0);
}
