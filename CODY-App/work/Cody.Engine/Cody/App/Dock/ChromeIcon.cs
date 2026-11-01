using System;
using System.Threading.Tasks;
using HeyClicky.Core.Browser;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Storage;
using Windows.Storage.FileProperties;

namespace HeyClicky.App.Dock;

internal static class ChromeIcon
{
	private static ImageSource? icon;

	private static bool loading;

	public static FrameworkElement? Make(double size)
	{
		(string, string)? tuple = ChromiumBrowsers.Preferred();
		if (tuple.HasValue)
		{
			(string, string) valueOrDefault = tuple.GetValueOrDefault();
			Image image = new Image
			{
				Width = size,
				Height = size,
				Stretch = Stretch.Uniform
			};
			if ((object)icon != null)
			{
				image.Source = icon;
			}
			else if (!loading)
			{
				loading = true;
				LoadAsync(valueOrDefault.Item2, image);
			}
			return image;
		}
		return null;
	}

	private static async Task LoadAsync(string executable, Image image)
	{
		_ = 2;
		try
		{
			using StorageItemThumbnail thumbnail = await (await StorageFile.GetFileFromPathAsync(executable)).GetThumbnailAsync(ThumbnailMode.SingleItem, 64u);
			BitmapImage bitmap = new BitmapImage();
			await bitmap.SetSourceAsync(thumbnail);
			icon = bitmap;
			image.Source = bitmap;
		}
		catch (Exception ex)
		{
			Log.Warn("dock", "browser icon: " + ex.Message);
		}
		finally
		{
			loading = false;
		}
	}
}
