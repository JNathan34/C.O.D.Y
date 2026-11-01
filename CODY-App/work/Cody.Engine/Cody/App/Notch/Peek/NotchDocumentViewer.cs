using System;
using System.IO;
using System.Linq;
using HeyClicky.App.Design;
using HeyClicky.App.Home;
using HeyClicky.App.UI;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace HeyClicky.App.Notch.Peek;

public sealed class NotchDocumentViewer : Grid
{
	private readonly Border pane;

	private readonly DispatcherQueue dq;

	private FileSystemWatcher? watcher;

	private DispatcherQueueTimer? mountTimer;

	private DispatcherQueueTimer? reloadTimer;

	private string? shownPath;

	private int version;

	public NotchDocumentViewer(INotchHost host)
	{
		dq = DispatcherQueue.GetForCurrentThread();
		pane = new Border
		{
			Background = Ui.Brush(HomeTheme.SidebarFill),
			CornerRadius = new CornerRadius(12.0),
			BorderBrush = Ui.Brush(DS.White(0.08)),
			BorderThickness = new Thickness(1.0),
			Margin = new Thickness(4.0, 6.0, 4.0, 4.0)
		};
		Children.Add(pane);
		Unloaded += (object _, RoutedEventArgs _) =>
		{
			StopWatching();
		};
	}

	public void Show(string? path)
	{
		if (path == shownPath)
		{
			return;
		}
		shownPath = path;
		int v = ++version;
		pane.Child = null;
		StopWatching();
		if (path == null)
		{
			return;
		}
		mountTimer?.Stop();
		mountTimer = dq.CreateTimer().Rooted();
		mountTimer.Interval = NotchPeekLayout.DocumentMountDelay;
		mountTimer.IsRepeating = false;
		mountTimer.Tick += (DispatcherQueueTimer _, object _) =>
		{
			if (v == version)
			{
				Mount(path, v);
			}
		};
		mountTimer.Start();
	}

	private void Mount(string path, int v)
	{
		if (v != version)
		{
			return;
		}
		INotchDocumentRenderer notchDocumentRenderer = NotchExtensions.DocumentRenderers.FirstOrDefault((INotchDocumentRenderer r) => r.CanRender(path));
		INotchDocumentRenderer notchDocumentRenderer2 = notchDocumentRenderer ?? NotchDocumentRenderers.For(path);
		try
		{
			pane.Child = notchDocumentRenderer2.Render(path, () =>
			{
				dq.TryEnqueue(() =>
				{
					if (v == version)
					{
						Mount(path, v);
					}
				});
			});
		}
		catch (Exception ex)
		{
			Log.Warn("notch-doc", "render " + Path.GetFileName(path) + " failed: " + ex.Message);
			pane.Child = NotchDocumentRenderers.Message("This document couldn’t be loaded.");
		}
		Ui.ClipRounded(pane, 12.0);
		if (notchDocumentRenderer == null)
		{
			Watch(path, v);
		}
		Log.Info("notch-doc", $"showing {Path.GetFileName(path)} ({ChatBlockViews.Kind(path)})");
	}

	private void Watch(string path, int v)
	{
		try
		{
			string directoryName = Path.GetDirectoryName(path);
			if (directoryName == null || !Directory.Exists(directoryName))
			{
				return;
			}
			watcher = new FileSystemWatcher(directoryName, Path.GetFileName(path))
			{
				NotifyFilter = (NotifyFilters.Size | NotifyFilters.LastWrite),
				EnableRaisingEvents = true
			};
			watcher.Changed += (object _, FileSystemEventArgs _) =>
			{
				dq.TryEnqueue(() =>
				{
					if (v == version)
					{
						reloadTimer?.Stop();
						reloadTimer = dq.CreateTimer().Rooted();
						reloadTimer.Interval = TimeSpan.FromMilliseconds(300L, 0L);
						reloadTimer.IsRepeating = false;
						reloadTimer.Tick += (DispatcherQueueTimer dispatcherQueueTimer, object obj) =>
						{
							if (v == version)
							{
								Mount(path, v);
							}
						};
						reloadTimer.Start();
					}
				});
			};
		}
		catch (Exception ex)
		{
			Log.Warn("notch-doc", "watch: " + ex.Message);
		}
	}

	private void StopWatching()
	{
		watcher?.Dispose();
		watcher = null;
	}
}
