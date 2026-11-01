using System;
using System.Collections.Generic;
using System.Numerics;
using HeyClicky.App.Design;
using HeyClicky.App.UI;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.UI;

namespace HeyClicky.App.Onboarding;

public sealed class KeyCap : Grid
{
	public enum Size
	{
		Regular,
		Compact,
		Mini
	}

	private readonly Border plate;

	private readonly TextBlock symbol;

	private readonly ShadowLayer restShadow;

	private readonly ShadowLayer pressShadow;

	private readonly Color accent;

	private bool pressed;

	public bool Pressed
	{
		get
		{
			return pressed;
		}
		set
		{
			if (value != pressed)
			{
				pressed = value;
				Apply(value, animate: true);
			}
		}
	}

	public int? VirtualKey { get; init; }

	public KeyCap(string symbolText, string name, Size size, Color accent)
	{
		this.accent = accent;
		(double, double, double, double, double) tuple = size switch
		{
			Size.Regular => (84.0, 26.0, 11.0, 6.0, 14.0), 
			Size.Compact => (56.0, 18.0, 9.0, 3.0, 14.0), 
			_ => (44.0, 14.0, 9.0, 3.0, 8.0), 
		};
		double item = tuple.Item1;
		double item2 = tuple.Item2;
		double item3 = tuple.Item3;
		double item4 = tuple.Item4;
		double item5 = tuple.Item5;
		double size2 = ((symbolText.Length > 2) ? Math.Min(item2, item * 0.62 / ((double)symbolText.Length * 0.58)) : item2);
		Width = item;
		Height = item;
		restShadow = new ShadowLayer(item5, DS.Black(0.35), 4.0, 3.0);
		pressShadow = new ShadowLayer(item5, accent.WithAlpha(0.35), 10.0, 1.0)
		{
			Opacity = 0.0
		};
		plate = new Border
		{
			CornerRadius = new CornerRadius(item5),
			BorderThickness = new Thickness(0.5)
		};
		symbol = Ui.Text(symbolText, size2, FontWeights.SemiBold, DS.Colors.TextPrimary, TextAlignment.Center);
		TextBlock item6 = Ui.Text(name, item3, FontWeights.Medium, DS.Colors.TextSecondary, TextAlignment.Center);
		StackPanel item7 = new StackPanel
		{
			Spacing = item4,
			HorizontalAlignment = HorizontalAlignment.Center,
			VerticalAlignment = VerticalAlignment.Center,
			Children = 
			{
				(UIElement)symbol,
				(UIElement)item6
			}
		};
		Children.Add(restShadow);
		Children.Add(pressShadow);
		Children.Add(plate);
		Children.Add(item7);
		CenterPoint = new Vector3((float)item / 2f, (float)item / 2f, 0f);
		Apply(down: false, animate: false);
	}

	public static List<KeyCap> ForBinding(HotkeyBinding binding, Size size, Color accent)
	{
		List<KeyCap> list = new List<KeyCap>();
		if (binding.Modifiers.HasFlag(HotkeyModifiers.Control))
		{
			list.Add(new KeyCap("Ctrl", "control", size, accent)
			{
				VirtualKey = 17
			});
		}
		if (binding.Modifiers.HasFlag(HotkeyModifiers.Alt))
		{
			list.Add(new KeyCap("Alt", "alt", size, accent)
			{
				VirtualKey = 18
			});
		}
		if (binding.Modifiers.HasFlag(HotkeyModifiers.Shift))
		{
			list.Add(new KeyCap("Shift", "shift", size, accent)
			{
				VirtualKey = 16
			});
		}
		if (binding.Modifiers.HasFlag(HotkeyModifiers.Win))
		{
			list.Add(new KeyCap("Win", "windows", size, accent)
			{
				VirtualKey = 91
			});
		}
		return list;
	}

	private void Apply(bool down, bool animate)
	{
		plate.Background = (down ? Ui.Vertical((0.0, DS.Hex(1710618u)), (1.0, DS.Hex(2302755u))) : Ui.Vertical((0.0, DS.Hex(3355443u)), (1.0, DS.Hex(2039583u))));
		plate.BorderBrush = Ui.Brush(down ? accent.WithAlpha(0.8) : DS.White(0.14));
		plate.BorderThickness = new Thickness(down ? 1.5 : 0.5);
		symbol.Foreground = Ui.Brush(down ? accent : DS.Colors.TextPrimary);
		restShadow.Opacity = ((!down) ? 1 : 0);
		pressShadow.Opacity = (down ? 1 : 0);
		SwiftSpring spring = new SwiftSpring(0.18, 0.7);
		if (animate)
		{
			Anim.ScaleSpring(this, down ? 0.94f : 1f, spring);
			Anim.TranslationSpring(this, new Vector3(0f, down ? 2 : 0, 0f), spring);
		}
	}
}
