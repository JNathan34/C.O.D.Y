using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using HeyClicky.Core.Documents;
using Windows.Foundation;
using Windows.Graphics.Imaging;
using Windows.Storage.Streams;

namespace HeyClicky.Core.Voice;

public static class Attachments
{
	public const string FilesOnlyWords = "Please review the attached files.";

	private const int ImageLaneMaxFileCount = 2;

	private const long ImageLaneMaxTotalBytes = 5000000L;
	private const long MaxImageSourceBytes = 25 * 1024 * 1024;
	private static readonly JsonSerializerOptions AttachmentJson = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

	public sealed record ChatContent(string Context, IReadOnlyList<byte[]> Images);
	private sealed record ChatFile(string Name, string Status, string? Text = null);

	private static readonly HashSet<string> ImageExtensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
	{
		"avif", "bmp", "gif", "heic", "heif", "jpeg", "jpg", "png", "tif", "tiff",
		"webp"
	};

	public static IReadOnlyList<string> NormalizedPaths(IEnumerable<string>? paths)
	{
		HashSet<string> hashSet = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
		List<string> list = new List<string>();
		foreach (string item in paths ?? Array.Empty<string>())
		{
			string text = item?.Trim() ?? "";
			if (text.Length != 0 && Path.IsPathFullyQualified(text))
			{
				string fullPath;
				try
				{
					fullPath = Path.GetFullPath(text);
				}
				catch
				{
					continue;
				}
				if (hashSet.Add(fullPath))
				{
					list.Add(fullPath);
				}
			}
		}
		return list;
	}

	public static bool IsImage(string path)
	{
		return ImageExtensions.Contains(Path.GetExtension(path).TrimStart('.'));
	}

	public static string SummaryLine(IReadOnlyList<string> paths)
	{
		return string.Join(", ", NormalizedPaths(paths).Select((string path) =>
		{
			string text = Path.GetExtension(path).TrimStart('.').ToLowerInvariant();
			string value = (IsImage(path) ? "image" : ((text.Length == 0) ? "file" : text));
			return $"{Path.GetFileName(path)} ({value}, {FormatBytes(FileSize(path))})";
		}));
	}

	public static async Task<ChatContent> ReadForChatAsync(IReadOnlyList<string> paths, CancellationToken ct = default, bool includeImages = true, int maximumCharacters = DocumentText.MaximumCharacters)
	{
		var files = new List<ChatFile>();
		var images = new List<byte[]>();
		long imageBytes = 0;
		int textLimit = maximumCharacters / Math.Max(1, paths.Count(path => !IsImage(path)));
		foreach (string path in paths)
		{
			ct.ThrowIfCancellationRequested();
			string name = Path.GetFileName(path);
			if (!IsImage(path))
			{
				var document = await Task.Run(() => DocumentText.Extract(path, textLimit), ct).ConfigureAwait(false);
				files.Add(new ChatFile(name, string.IsNullOrWhiteSpace(document.Text) ? "No readable text was extracted" :
					document.IsTruncated ? "Text excerpt, truncated" : "Extracted text", document.Text));
				continue;
			}
			if (!includeImages) continue;
			if (images.Count >= ImageLaneMaxFileCount || FileSize(path) > MaxImageSourceBytes)
			{
				files.Add(new ChatFile(name, "Image exceeds the per-message count or size limit"));
				continue;
			}
			byte[]? jpeg = await JpegAsync(path, maxDimension: 2048).ConfigureAwait(false);
			if (jpeg == null || imageBytes + jpeg.Length > ImageLaneMaxTotalBytes)
			{
				files.Add(new ChatFile(name, "Image could not be included"));
				continue;
			}
			images.Add(jpeg);
			imageBytes += jpeg.Length;
			files.Add(new ChatFile(name, $"Attached image {images.Count}"));
		}
		return new ChatContent(JsonSerializer.Serialize(files, AttachmentJson), images);
	}

	public static async Task<byte[]?> JpegAsync(string path, double quality = 0.85, int maxDimension = 4096)
	{
		_ = 6;
		try
		{
			byte[] source = await File.ReadAllBytesAsync(path).ConfigureAwait(continueOnCapturedContext: false);
			using InMemoryRandomAccessStream input = new InMemoryRandomAccessStream();
			await input.WriteAsync(source.AsBuffer());
			input.Seek(0uL);
			BitmapDecoder bitmapDecoder = await BitmapDecoder.CreateAsync(input);
			uint pixelWidth = bitmapDecoder.PixelWidth;
			uint pixelHeight = bitmapDecoder.PixelHeight;
			double num = Math.Min(1.0, (double)maxDimension / (double)Math.Max(pixelWidth, pixelHeight));
			BitmapTransform transform = new BitmapTransform
			{
				ScaledWidth = Math.Max(1u, (uint)Math.Round((double)pixelWidth * num)),
				ScaledHeight = Math.Max(1u, (uint)Math.Round((double)pixelHeight * num)),
				InterpolationMode = BitmapInterpolationMode.Fant
			};
			byte[] data = (await bitmapDecoder.GetPixelDataAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied, transform, ExifOrientationMode.RespectExifOrientation, ColorManagementMode.ColorManageToSRgb)).DetachPixelData();
			using InMemoryRandomAccessStream output = new InMemoryRandomAccessStream();
			BitmapPropertySet encodingOptions = new BitmapPropertySet { ["ImageQuality"] = new BitmapTypedValue(quality, PropertyType.Single) };
			BitmapEncoder bitmapEncoder = await BitmapEncoder.CreateAsync(BitmapEncoder.JpegEncoderId, output, encodingOptions);
			for (int i = 0; i < data.Length; i += 4)
			{
				byte b = data[i + 3];
				if (b != byte.MaxValue)
				{
					int num2 = 255 - b;
					data[i] = (byte)Math.Min(255, data[i] + num2);
					data[i + 1] = (byte)Math.Min(255, data[i + 1] + num2);
					data[i + 2] = (byte)Math.Min(255, data[i + 2] + num2);
					data[i + 3] = byte.MaxValue;
				}
			}
			bitmapEncoder.SetPixelData(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Ignore, transform.ScaledWidth, transform.ScaledHeight, 96.0, 96.0, data);
			await bitmapEncoder.FlushAsync();
			byte[] result = new byte[output.Size];
			output.Seek(0uL);
			await output.ReadAsync(result.AsBuffer(), (uint)result.Length, InputStreamOptions.None);
			return result;
		}
		catch (Exception ex)
		{
			Log.Warn("Attachments", "image " + Path.GetFileName(path) + " not read: " + ex.Message);
			return null;
		}
	}

	public static long FileSize(string path)
	{
		try
		{
			return new FileInfo(path).Length;
		}
		catch
		{
			return 0L;
		}
	}

	public static string FormatBytes(long bytes)
	{
		if (bytes <= 0)
		{
			return "Zero KB";
		}
		if (bytes < 1000)
		{
			return $"{bytes} bytes";
		}
		string[] array = new string[4] { "KB", "MB", "GB", "TB" };
		double num = bytes;
		int num2 = -1;
		do
		{
			num /= 1000.0;
			num2++;
		}
		while (num >= 1000.0 && num2 < array.Length - 1);
		string text;
		if (num2 == 0 || num >= 100.0)
		{
			text = "0";
		}
		else
		{
			text = ((num >= 10.0) ? "0.#" : "0.#");
		}
		return num.ToString(text, CultureInfo.InvariantCulture) + " " + array[num2];
	}
}
