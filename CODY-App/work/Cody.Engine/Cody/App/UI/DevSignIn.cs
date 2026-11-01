using HeyClicky.App.Services;
using Microsoft.UI.Xaml;

namespace HeyClicky.App.UI;

public static class DevSignIn
{
	public static GelButton? Button(IAppActions actions, GelButton.Sizing size = GelButton.Sizing.Normal)
	{
		if (!actions.DevSignInAvailable)
		{
			return null;
		}
		GelButton gelButton = new GelButton("Sign in with local test account", GelAppearance.SecondaryOutline, size, 100.0);
		gelButton.HorizontalAlignment = HorizontalAlignment.Center;
		gelButton.Click += () =>
		{
			actions.DevSignInAsync();
		};
		return gelButton;
	}
}
