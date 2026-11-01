using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;

namespace HeyClicky.Agents.Runtime;

internal sealed class CodexAppServerProcess : IDisposable
{
	private readonly Process process;

	private int stopped;

	public CodexRpcClient Client { get; }

	public int ProcessId { get; }

	public DateTimeOffset StartedAt { get; } = DateTimeOffset.Now;

	public bool IsRunning
	{
		get
		{
			if (!process.HasExited)
			{
				return !Client.IsClosed;
			}
			return false;
		}
	}

	public IReadOnlyDictionary<string, string> SpawnEnvironment { get; }

	public event Action<int>? ExitedUnexpectedly;

	private CodexAppServerProcess(Process process, IReadOnlyDictionary<string, string> spawnEnvironment)
	{
		this.process = process;
		ProcessId = process.Id;
		SpawnEnvironment = spawnEnvironment;
		Client = new CodexRpcClient(process.StandardInput.BaseStream, process.StandardOutput.BaseStream);
	}

	public static CodexAppServerProcess Start(string codexExecutable, string codexHome, IReadOnlyDictionary<string, string> managedEnvironment)
	{
		if (!File.Exists(codexExecutable))
		{
			throw new FileNotFoundException("HeyClicky's bundled Codex runtime is missing from this build. Run windows\\scripts\\bundle-codex-runtime.ps1.", codexExecutable);
		}
		string directoryName = Path.GetDirectoryName(codexExecutable);
		string directoryName2 = Path.GetDirectoryName(directoryName);
		ProcessStartInfo processStartInfo = new ProcessStartInfo(codexExecutable, "app-server")
		{
			UseShellExecute = false,
			RedirectStandardInput = true,
			RedirectStandardOutput = true,
			RedirectStandardError = true,
			CreateNoWindow = true,
			StandardOutputEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false),
			StandardErrorEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false),
			StandardInputEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false),
			WorkingDirectory = codexHome
		};
		processStartInfo.Environment["CODEX_HOME"] = codexHome;
		IEnumerable<string> source = new string[2]
		{
			directoryName,
			Path.Combine(directoryName2, "codex-path")
		}.Where(Directory.Exists);
		string element = (processStartInfo.Environment.TryGetValue("PATH", out string value) ? (value ?? "") : "");
		processStartInfo.Environment["PATH"] = string.Join(';', from s in source.Append(element)
			where !string.IsNullOrEmpty(s)
			select s);
		processStartInfo.Environment.Remove("GEMINI_API_KEY");
		foreach (var (key, value2) in managedEnvironment)
		{
			processStartInfo.Environment[key] = value2;
		}
		Process process = new Process
		{
			StartInfo = processStartInfo,
			EnableRaisingEvents = true
		};
		if (!process.Start())
		{
			throw new InvalidOperationException("codex app-server failed to start");
		}
		try
		{
			KillOnCloseJob.Shared?.Assign(process);
		}
		catch (Exception ex)
		{
			Log.Error("Codex", "could not assign app-server to job object", ex);
		}
		CodexAppServerProcess server = new CodexAppServerProcess(process, new Dictionary<string, string>(managedEnvironment));
		process.ErrorDataReceived += (object _, DataReceivedEventArgs e) =>
		{
			if (!string.IsNullOrWhiteSpace(e.Data))
			{
				Log.Warn("Codex stderr", e.Data);
			}
		};
		process.BeginErrorReadLine();
		process.Exited += (object? _, EventArgs _) =>
		{
			server.OnExited();
		};
		server.Client.StartReading();
		Log.Info("Codex", $"started app-server pid={process.Id} CODEX_HOME={codexHome}");
		return server;
	}

	private void OnExited()
	{
		int num;
		try
		{
			num = process.ExitCode;
		}
		catch
		{
			num = -1;
		}
		if (Volatile.Read(in stopped) != 0)
		{
			Log.Info("Codex", $"app-server pid={ProcessId} exited after stop (code {num})");
		}
		else
		{
			Log.Error("Codex", $"app-server pid={ProcessId} exited unexpectedly with code {num}");
			ExitedUnexpectedly?.Invoke(num);
		}
	}

	public void Stop()
	{
		if (Interlocked.Exchange(ref stopped, 1) != 0)
		{
			return;
		}
		Client.Dispose();
		try
		{
			if (!process.WaitForExit(1500))
			{
				process.Kill(entireProcessTree: true);
			}
		}
		catch (Exception ex) when ((ex is InvalidOperationException || ex is Win32Exception) ? true : false)
		{
		}
	}

	public void Dispose()
	{
		Stop();
		process.Dispose();
	}
}
