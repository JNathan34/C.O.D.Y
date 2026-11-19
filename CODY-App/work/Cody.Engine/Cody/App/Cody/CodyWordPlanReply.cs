using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using HeyClicky.Core.Brain;

namespace HeyClicky.App.Cody;

// Decode response envelopes only. Never execute returned code or turn narration
// into document text. The local Word controller still validates every plan step.
internal static class CodyWordPlanReply
{
    internal static bool TryParse(string raw, out JsonElement plan)
    {
        // JSON must be tried before scanning say() calls: document prose can itself
        // contain examples of say(), quotes, braces and Markdown fences.
        if (TryObject(raw, out plan)) return true;
        var spoken = SayLines.InOrder(raw, completeOnly: true);
        if (TryCandidates(spoken, out plan)) return true;
        if (spoken.Count > 1 && TryObject(string.Join("\n", spoken), out plan)) return true;
        return TryCandidates(FencedBlocks(raw), out plan);
    }

    private static bool TryCandidates(IEnumerable<string> values, out JsonElement plan)
    {
        plan = default;
        var candidates = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (string value in values)
        {
            if (TryObject(value, out var candidate)) candidates.TryAdd(candidate.GetRawText(), candidate);
            else foreach (string block in FencedBlocks(value))
                if (TryObject(block, out candidate)) candidates.TryAdd(candidate.GetRawText(), candidate);
        }
        if (candidates.Count != 1) return false;
        plan = candidates.Values.Single();
        return true;
    }

    private static IEnumerable<string> FencedBlocks(string text)
    {
        string[] lines = text.Replace("\r\n", "\n").Split('\n');
        int start = -1;
        for (int index = 0; index < lines.Length; index++)
        {
            string line = lines[index].Trim();
            if (start >= 0)
            {
                if (line != "```") continue;
                yield return string.Join("\n", lines.Skip(start).Take(index - start));
                start = -1;
            }
            else if (line == "```" || line.Equals("```json", StringComparison.OrdinalIgnoreCase)) start = index + 1;
        }
    }

    private static bool TryObject(string text, out JsonElement plan)
    {
        plan = default;
        try
        {
            using var document = JsonDocument.Parse(text);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return false;
            bool steps = root.TryGetProperty("steps", out var value) && value.ValueKind == JsonValueKind.Array;
            int responses = new[] { "question", "answer", "unsupported" }.Count(name =>
                root.TryGetProperty(name, out var response) && response.ValueKind == JsonValueKind.String &&
                !string.IsNullOrWhiteSpace(response.GetString()));
            if ((steps ? 1 : 0) + responses != 1) return false;
            plan = root.Clone();
            return true;
        }
        catch (JsonException) { return false; }
    }
}
