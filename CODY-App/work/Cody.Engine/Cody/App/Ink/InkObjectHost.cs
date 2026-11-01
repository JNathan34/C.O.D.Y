using System;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace HeyClicky.App.Ink;

public sealed class InkObjectHost : Grid, IInkBaseline
{
	private readonly Func<FrameworkElement> build;

	private readonly ClickyInkEnvironment environment;

	public double? FirstBaseline
	{
		get
		{
			if (Children.Count <= 0)
			{
				return null;
			}
			return InkBaseline.First(Children[0]);
		}
	}

	public InkObjectHost(InkObjectState state, Func<FrameworkElement> build)
	{
		this.build = build;
		environment = ClickyInkEnvironment.Current;
		state.Attach(this);
		HorizontalAlignment = HorizontalAlignment.Left;
		Children.Add(build());
	}

	public void Refresh()
	{
		FrameworkElement item;
		using (ClickyInkEnvironment.Use(environment))
		{
			item = build();
		}
		Children.Clear();
		Children.Add(item);
	}
}
