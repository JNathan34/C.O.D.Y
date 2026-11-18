namespace HeyClicky.App.Cody;

internal static class CodyDrawingControlState
{
    internal static bool IsDrawable(string kind)
        => kind is "Shape" or "Text" or "Wash" or "Dot" or "Window" or "Photo";
    internal static bool IsPressable(string kind,bool invokes)
        => invokes || kind is "Button" or "Hyperlink" or "CheckBox" or "RadioButton" or
            "MenuItem" or "SplitButton" or "TabItem" or "ComboBox" or "Edit";
    internal static double HitDistance(double x,double y,double left,double top,double width,double height)
    {
        double dx=System.Math.Max(0,System.Math.Max(left-x,x-left-width));
        double dy=System.Math.Max(0,System.Math.Max(top-y,y-top-height));
        return dx*dx+dy*dy;
    }
    // A computer-use stream can render target/window/photo UI without actually
    // drawing ink. Do not offer Clear for those non-annotation visuals.
    internal static bool HasContent(bool showing,bool faded,int renderedUnits,int models,int inkedMarks)
        => showing&&!faded&&(models>0||(inkedMarks>0&&renderedUnits>0));

    // Avoid Clear flashing during transient empty native composition frames.
    // An actual clear, fade, window hide or generation change must still hide it.
    internal static bool KeepClearDuringStream(bool streaming,bool showing,bool faded,
        bool sameGeneration,bool hasContent,bool ownerHidden)
        => streaming&&showing&&!faded&&sameGeneration&&hasContent&&!ownerHidden;
}
