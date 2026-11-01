using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using HeyClicky.Core.Documents.Markdown;
using Windows.Graphics.Imaging;
using Windows.Storage.Streams;

namespace HeyClicky.App.Documents;

public sealed class MarkdownViewerPreparedDocument
{
	private static readonly HttpClient Http = CreateHttp();

	public IReadOnlyList<MarkdownViewerBlock> Blocks { get; }

	public string? BaseDirectory { get; }

	public IReadOnlyDictionary<string, MarkdownViewerImage> Images { get; }

	public IReadOnlyList<string> RemoteImageSourcesToLoad { get; }

	private MarkdownViewerPreparedDocument(IReadOnlyList<MarkdownViewerBlock> blocks, string? baseDirectory, IReadOnlyDictionary<string, MarkdownViewerImage> images, IReadOnlyList<string> remote)
	{
		Blocks = blocks;
		BaseDirectory = baseDirectory;
		Images = images;
		RemoteImageSourcesToLoad = remote;
	}

	private static HttpClient CreateHttp()
	{
		HttpClient httpClient = new HttpClient();
		httpClient.Timeout = TimeSpan.FromSeconds(30L);
		httpClient.DefaultRequestHeaders.UserAgent.ParseAdd("HeyClicky/1.0 (Windows)");
		return httpClient;
	}

	public static bool IsRemote(string source)
	{
		if (!source.StartsWith("http://", StringComparison.Ordinal))
		{
			return source.StartsWith("https://", StringComparison.Ordinal);
		}
		return true;
	}

	public static async Task<MarkdownViewerPreparedDocument> PrepareAsync(IReadOnlyList<MarkdownViewerBlock> blocks, string? baseDirectory, IReadOnlyDictionary<string, byte[]>? remoteImagesBySource = null, CancellationToken ct = default(CancellationToken))
	{
		Dictionary<string, MarkdownViewerImage> images = new Dictionary<string, MarkdownViewerImage>();
		List<string> remote = new List<string>();
		byte[] bytes = default;
		(double Width, double Height) size = default;
		foreach (MarkdownViewerBlock.Image image in ImageBlocks(blocks))
		{
			ct.ThrowIfCancellationRequested();
			if (images.ContainsKey(image.Source))
			{
				continue;
			}
			if (IsRemote(image.Source))
			{
				bool flag = remoteImagesBySource?.TryGetValue(image.Source, out bytes) ?? false;
				if (flag)
				{
					(double, double)? tuple = await MeasureAsync(bytes);
					int num;
					if (tuple.HasValue)
					{
						size = tuple.GetValueOrDefault();
						num = 1;
					}
					else
					{
						num = 0;
					}
					flag = (byte)num != 0;
				}
				if (flag)
				{
					images[image.Source] = new MarkdownViewerImage(null, bytes, size.Width, size.Height);
				}
				else if (remoteImagesBySource == null || !remoteImagesBySource.ContainsKey(image.Source))
				{
					remote.Add(image.Source);
				}
				bytes = null;
			}
			else
			{
				MarkdownViewerImage markdownViewerImage = await LoadLocalImageAsync(image.Source, baseDirectory);
				if ((object)markdownViewerImage != null)
				{
					images[image.Source] = markdownViewerImage;
				}
			}
		}
		return new MarkdownViewerPreparedDocument(blocks, baseDirectory, images, remote);
	}

	public static async Task<Dictionary<string, byte[]>> DownloadAsync(IEnumerable<string> sources, CancellationToken ct)
	{
		Dictionary<string, byte[]> loaded = new Dictionary<string, byte[]>();
		foreach (string source in sources.Distinct())
		{
			ct.ThrowIfCancellationRequested();
			try
			{
				if (Uri.TryCreate(source, UriKind.Absolute, out Uri result))
				{
					byte[] bytes = await Http.GetByteArrayAsync(result, ct);
					if ((await MeasureAsync(bytes)).HasValue)
					{
						loaded[source] = bytes;
					}
				}
			}
			catch (OperationCanceledException) when (ct.IsCancellationRequested)
			{
				throw;
			}
			catch (Exception ex2)
			{
				Log.Info("markdown", "image " + source + " not loaded: " + ex2.Message);
			}
		}
		return loaded;
	}

	private static IEnumerable<MarkdownViewerBlock.Image> ImageBlocks(IEnumerable<MarkdownViewerBlock> blocks)
	{
		foreach (MarkdownViewerBlock block in blocks)
		{
			if (block is MarkdownViewerBlock.Image image)
			{
				yield return image;
			}
			else
			{
				if (!(block is MarkdownViewerBlock.Blockquote blockquote))
				{
					continue;
				}
				foreach (MarkdownViewerBlock.Image item in ImageBlocks(blockquote.ChildBlocks))
				{
					yield return item;
				}
			}
		}
	}

	private static async Task<MarkdownViewerImage?> LoadLocalImageAsync(string source, string? baseDirectory)
	{
		string text = source;
		if (text.StartsWith("file://", StringComparison.OrdinalIgnoreCase) && Uri.TryCreate(text, UriKind.Absolute, out Uri result))
		{
			text = result.LocalPath;
		}
		List<string> list = new List<string> { text };
		string text2 = Uri.UnescapeDataString(text);
		if (text2 != text)
		{
			list.Add(text2);
		}
		foreach (string item in list)
		{
			string text3;
			if (!item.StartsWith('~'))
			{
				text3 = item;
			}
			else
			{
				string folderPath = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
				string text4 = item;
				text3 = Path.Combine(folderPath, text4.Substring(1, text4.Length - 1).TrimStart(new char[2] { '/', '\\' }));
			}
			string text5 = text3;
			string resolved;
			if ((Path.IsPathRooted(text5) && !text5.StartsWith('\\')) || text5.StartsWith("\\\\", StringComparison.Ordinal))
			{
				resolved = text5;
			}
			else
			{
				if (baseDirectory == null)
				{
					continue;
				}
				resolved = Path.Combine(baseDirectory, item.TrimStart(new char[2] { '/', '\\' }));
			}
			try
			{
				if (File.Exists(resolved))
				{
					(double, double)? tuple = await MeasureAsync(await File.ReadAllBytesAsync(resolved));
					if (tuple.HasValue)
					{
						(double, double) valueOrDefault = tuple.GetValueOrDefault();
						return new MarkdownViewerImage(resolved, null, valueOrDefault.Item1, valueOrDefault.Item2);
					}
				}
			}
			catch (Exception ex)
			{
				Log.Info("markdown", "image " + resolved + " not loaded: " + ex.Message);
			}
		}
		return null;
	}

	private static async Task<(double Width, double Height)?> MeasureAsync(byte[] bytes)
	{
		_ = 1;
		try
		{
			using InMemoryRandomAccessStream stream = new InMemoryRandomAccessStream();
			await stream.WriteAsync(bytes.AsBuffer());
			stream.Seek(0uL);
			BitmapDecoder bitmapDecoder = await BitmapDecoder.CreateAsync(stream);
			double num = bitmapDecoder.PixelWidth;
			double num2 = bitmapDecoder.PixelHeight;
			double dpiX = bitmapDecoder.DpiX;
			if (dpiX > 1.0 && Math.Abs(dpiX - 72.0) > 1.0 && Math.Abs(dpiX - 96.0) > 1.0)
			{
				num = num * 72.0 / dpiX;
				num2 = num2 * 72.0 / bitmapDecoder.DpiY;
			}
			return (num > 0.0 && num2 > 0.0) ? new (double, double)?((num, num2)) : (((double, double)?)null);
		}
		catch
		{
			return null;
		}
	}
}
