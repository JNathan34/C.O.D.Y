using System;
using System.Threading;
using System.Threading.Tasks;

namespace HeyClicky.Agents.Runtime;

public static class CodexReadyRetry
{
	public static bool ShouldRetry(Exception error)
	{
		if (!(error is CodexProcessNotRunningException))
		{
			if (error is CodexRpcException ex)
			{
				return ex.Code == -32600 && ex.ServerMessage.Contains("not initialized", StringComparison.OrdinalIgnoreCase);
			}
			return false;
		}
		return true;
	}

	public static async Task<T> RunAsync<T>(Func<Task> ensureReady, Func<Task<T>> operation, Func<bool> hasActiveTurns, Func<Task> restart, CancellationToken ct)
	{
		T result = default;
		Exception ex2 = default;
		int num;
		try
		{
			await ensureReady().ConfigureAwait(continueOnCapturedContext: false);
			ct.ThrowIfCancellationRequested();
			result = await operation().ConfigureAwait(continueOnCapturedContext: false);
			return result;
		}
		catch (Exception ex) when (((Func<bool>)delegate
		{
			// Could not convert BlockContainer to single expression
			ex2 = ex;
			return ShouldRetry(ex) && !hasActiveTurns();
		}).Invoke())
		{
			num = 1;
		}
		if (num != 1)
		{
			return result;
		}
		Log.Warn("Agents", "Codex runtime was not ready (" + ex2.Message + "); restarting once and retrying");
		await restart().ConfigureAwait(continueOnCapturedContext: false);
		await ensureReady().ConfigureAwait(continueOnCapturedContext: false);
		ct.ThrowIfCancellationRequested();
		return await operation().ConfigureAwait(continueOnCapturedContext: false);
	}
}
