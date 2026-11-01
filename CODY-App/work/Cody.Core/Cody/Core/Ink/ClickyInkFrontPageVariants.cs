namespace HeyClicky.Core.Ink;

public static class ClickyInkFrontPageVariants
{
	public static string RawValue(this ClickyInkFrontPageVariant variant)
	{
		if (variant != ClickyInkFrontPageVariant.Broadsheet)
		{
			return "missionControl";
		}
		return "broadsheet";
	}
}
