using System;
using System.IO;
using HeyClicky.App.Notch.Peek;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;

namespace HeyClicky.App.Documents;

public sealed class NotchDocumentRenderer : INotchDocumentRenderer
{
	public static void Register()
	{
		NotchExtensions.RegisterDocumentRenderer(new NotchDocumentRenderer());
	}

	public bool CanRender(string path)
	{
		return DocumentViewers.HasViewer(path);
	}

	public FrameworkElement Render(string path, Action reload)
	{
		FrameworkElement frameworkElement = DocumentViewers.CreateViewer(path, Fallback) ?? Fallback();
		if (DocumentViewers.IsSpreadsheet(path))
		{
			WatchForRewrites(frameworkElement, path, reload);
		}
		return frameworkElement;
		FrameworkElement Fallback()
		{
			return NotchDocumentRenderers.For(path).Render(path, reload);
		}
	}

	private static void WatchForRewrites(FrameworkElement viewer, string path, Action reload)
	{
		DispatcherQueue dq = DispatcherQueue.GetForCurrentThread();
		FileSystemWatcher watcher = null;
		DispatcherQueueTimer timer = null;
		try
		{
			string directoryName = Path.GetDirectoryName(path);
			if (directoryName == null || !Directory.Exists(directoryName))
			{
				return;
			}
			watcher = new FileSystemWatcher(directoryName, Path.GetFileName(path))
			{
				NotifyFilter = (NotifyFilters.FileName | NotifyFilters.Size | NotifyFilters.LastWrite),
				EnableRaisingEvents = true
			};
			watcher.Changed += (object _, FileSystemEventArgs _) =>
			{
				Changed();
			};
			watcher.Renamed += (object _, RenamedEventArgs _) =>
			{
				Changed();
			};
			watcher.Created += (object _, FileSystemEventArgs _) =>
			{
				Changed();
			};
		}
		catch (Exception ex)
		{
			Log.Warn("notch-doc", "watch " + Path.GetFileName(path) + ": " + ex.Message);
		}
		viewer.Unloaded += (object _, RoutedEventArgs _) =>
		{
			watcher?.Dispose();
			watcher = null;
			timer?.Stop();
		};
		void Changed()
		{
			dq.TryEnqueue(() =>
			{
				if ((object)timer == null)
				{
					timer = dq.CreateTimer().Rooted();
				}
				timer.Interval = TimeSpan.FromMilliseconds(300L, 0L);
				timer.IsRepeating = false;
				timer.Tick -= OnTick;
				timer.Tick += OnTick;
				timer.Stop();
				timer.Start();
			});
		}
		void OnTick(DispatcherQueueTimer t, object o)
		{
			watcher?.Dispose();
			watcher = null;
			reload();
		}
	}
}
