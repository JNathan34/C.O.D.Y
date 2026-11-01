using System;
using System.Threading;
using System.Threading.Tasks;

namespace HeyClicky.App.Cody;

internal static class CodyControlSpeed
{
    // These timings affect computer actions, not the user's floating mascot.
    internal static double GlideSeconds(double distance, double requested) =>
        Math.Min(Math.Max(requested, .08), Math.Clamp(distance / 10000, .08, .18));

    internal static int ActionPause(string action) => action is "move" or "wait" ? 0 : 20;

    // A final full-resolution screenshot always follows this lightweight check.
    // Bound animated pages and stalled captures without waiting for video to stop.
    internal static async Task WaitForScreenAsync(
        Func<CancellationToken, Task<byte[]?>> sample,
        Func<byte[], byte[], double> changedFraction,
        CancellationToken ct)
    {
        using var budget = CancellationTokenSource.CreateLinkedTokenSource(ct);
        budget.CancelAfter(800);
        var token = budget.Token;
        try
        {
            var previous = await sample(token).WaitAsync(token).ConfigureAwait(false);
            await Task.Delay(100, token).ConfigureAwait(false);
            if (previous == null) return;
            int calm = 0;
            while (true)
            {
                var current = await sample(token).WaitAsync(token).ConfigureAwait(false);
                if (current == null) return;
                calm = changedFraction(previous, current) <= .005 ? calm + 1 : 0;
                if (calm >= 2) return;
                previous = current;
                await Task.Delay(60, token).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested) { }
        ct.ThrowIfCancellationRequested();
    }
}
