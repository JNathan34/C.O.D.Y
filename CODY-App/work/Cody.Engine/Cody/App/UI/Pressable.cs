using System;
using System.Numerics;
using HeyClicky.App.Design;
using Microsoft.UI.Input;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Shapes;
using Windows.Foundation;

namespace HeyClicky.App.UI;

public class Pressable : Grid
{
	private bool enabled = true;

	private bool pressArmed;

	private CornerRadius requestedCorners;

	private bool fittingCorners;

	private static InputCursor? sharedHand;

	private static InputCursor? sharedArrow;

	public bool IsHovered { get; private set; }

	public bool IsPressed { get; private set; }

	public bool Enabled
	{
		get
		{
			return enabled;
		}
		set
		{
			bool flag = enabled != value;
			enabled = value;
			if (flag || (object)ProtectedCursor == null)
			{
				ProtectedCursor = (value ? HandCursor : ArrowCursor);
			}
		}
	}

	internal static InputCursor HandCursor => sharedHand ?? (sharedHand = InputSystemCursor.Create(InputSystemCursorShape.Hand));

	internal static InputCursor ArrowCursor => sharedArrow ?? (sharedArrow = InputSystemCursor.Create(InputSystemCursorShape.Arrow));

	public bool? AccessibleToggleState { get; set; }

	public event Action? Click;

	public event Action<bool>? HoverChanged;

	public event Action<bool>? PressedChanged;

	private void SetPressedLook(bool pressed)
	{
		if (IsPressed != pressed)
		{
			IsPressed = pressed;
			PressedChanged?.Invoke(pressed);
		}
	}

	public Pressable(bool handCursor = true)
	{
		Background = Ui.Transparent;
		if (handCursor)
		{
			ProtectedCursor = HandCursor;
		}
		PointerEntered += (object _, PointerRoutedEventArgs _) =>
		{
			IsHovered = true;
			HoverChanged?.Invoke(obj: true);
		};
		PointerExited += (object _, PointerRoutedEventArgs e) =>
		{
			if (!PointerFrames.IsStale(e))
			{
				IsHovered = false;
				HoverChanged?.Invoke(obj: false);
				SetPressedLook(pressed: false);
			}
		};
		PointerPressed += (object _, PointerRoutedEventArgs e) =>
		{
			if (enabled && e.GetCurrentPoint(this).Properties.IsLeftButtonPressed)
			{
				CapturePointer(e.Pointer);
				pressArmed = true;
				SetPressedLook(pressed: true);
				e.Handled = true;
			}
		};
		PointerReleased += (object _, PointerRoutedEventArgs e) =>
		{
			if (pressArmed)
			{
				pressArmed = false;
				ReleasePointerCapture(e.Pointer);
				SetPressedLook(pressed: false);
				Point position = e.GetCurrentPoint(this).Position;
				if (enabled && position.X >= 0.0 && position.Y >= 0.0 && position.X <= ActualWidth && position.Y <= ActualHeight)
				{
					Click?.Invoke();
				}
				e.Handled = true;
			}
		};
		PointerCaptureLost += (object _, PointerRoutedEventArgs _) =>
		{
			SetPressedLook(pressed: false);
		};
		RegisterPropertyChangedCallback(Grid.CornerRadiusProperty, (DependencyObject _, DependencyProperty _) =>
		{
			if (!fittingCorners)
			{
				requestedCorners = CornerRadius;
				FitCorners();
			}
		});
		SizeChanged += (object _, SizeChangedEventArgs _) =>
		{
			FitCorners();
		};
	}

	private void FitCorners()
	{
		double num = Math.Min(ActualWidth, ActualHeight) / 2.0;
		if (!(num <= 0.0))
		{
			CornerRadius cornerRadius = requestedCorners;
			CornerRadius cornerRadius2 = new CornerRadius(Math.Min(cornerRadius.TopLeft, num), Math.Min(cornerRadius.TopRight, num), Math.Min(cornerRadius.BottomRight, num), Math.Min(cornerRadius.BottomLeft, num));
			if (!(cornerRadius2 == CornerRadius))
			{
				fittingCorners = true;
				CornerRadius = cornerRadius2;
				fittingCorners = false;
			}
		}
	}

	public void RaiseClick()
	{
		Click?.Invoke();
	}

	protected override AutomationPeer OnCreateAutomationPeer()
	{
		return new PressableAutomationPeer(this);
	}

	public Pressable WithPressScale(float scale = 0.97f, double seconds = 0.14, bool easeOut = false)
	{
		PressedChanged += (bool p) =>
		{
			CenterPoint = new Vector3((float)ActualWidth / 2f, (float)ActualHeight / 2f, 0f);
			Anim.Scale(this, p ? scale : 1f, seconds, easeOut ? Easing.EaseOut(Ui.Compositor) : Easing.Expressive(Ui.Compositor));
		};
		return this;
	}

	public Pressable WithIconHover(double diameter)
	{
		ShadowLayer shadow = new ShadowLayer(diameter / 2.0, DS.Black(0.18), 5.0, 1.0)
		{
			Width = diameter,
			Height = diameter,
			Opacity = 0.0
		};
		Ellipse plate = new Ellipse
		{
			Width = diameter,
			Height = diameter,
			Fill = Ui.Brush(DS.White(0.06)),
			Stroke = Ui.Brush(DS.White(0.14)),
			StrokeThickness = 0.8,
			Opacity = 0.0,
			IsHitTestVisible = false
		};
		FrameworkElement[] array = new FrameworkElement[2] { shadow, plate };
		foreach (FrameworkElement obj in array)
		{
			obj.HorizontalAlignment = HorizontalAlignment.Center;
			obj.VerticalAlignment = VerticalAlignment.Center;
		}
		Children.Insert(0, plate);
		Children.Insert(0, shadow);
		HoverChanged += (bool h) =>
		{
			Anim.Opacity(shadow, h ? 1 : 0, 0.15, Easing.EaseOut(Ui.Compositor));
			Anim.Opacity(plate, h ? 1 : 0, 0.15, Easing.EaseOut(Ui.Compositor));
			Anim.Scale(this, (h && !Anim.Instant) ? 1.025f : 1f, 0.15, Easing.EaseOut(Ui.Compositor), new Vector3((float)ActualWidth / 2f, (float)ActualHeight / 2f, 0f));
		};
		return this;
	}

	public Pressable WithHoverScale(float scale, double seconds = 0.15, bool bottomAnchor = false)
	{
		HoverChanged += (bool h) =>
		{
			if (enabled)
			{
				CenterPoint = new Vector3((float)ActualWidth / 2f, bottomAnchor ? ((float)ActualHeight) : ((float)ActualHeight / 2f), 0f);
				Anim.Scale(this, h ? scale : 1f, seconds, Easing.EaseOut(Ui.Compositor));
			}
		};
		return this;
	}
}
