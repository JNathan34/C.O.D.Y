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
    internal static bool TryParseDraft(string raw, out JsonElement plan)
    {
        plan = default;
        var wrapped = SayLines.InOrder(raw, completeOnly: true);
        var drafts = ParseDrafts(new[] { raw }.Concat(FencedBlocks(raw, "text"))
            .Concat(wrapped).Concat(wrapped.SelectMany(line => FencedBlocks(line, "text"))))
            .Distinct(StringComparer.Ordinal).Take(2).ToArray();
        if (drafts.Length != 1) return false;
        var paragraphs = drafts[0].Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (paragraphs.Length is 0 or > 120) return false;
        plan = JsonSerializer.SerializeToElement(new
        {
            steps = paragraphs.Select(text => new { type = "paragraph", text, style = "normal" })
        });
        return true;
    }

    private static IEnumerable<string> ParseDrafts(IEnumerable<string> replies)
    {
        const string begin = "WORD_DRAFT_BEGIN\n";
        const string end = "\nWORD_DRAFT_END";
        foreach (string reply in replies)
        {
            string value = reply.Replace("\r\n", "\n").Trim();
            if (!value.StartsWith(begin, StringComparison.Ordinal) || !value.EndsWith(end, StringComparison.Ordinal))
                continue;
            if (value.Length <= begin.Length + end.Length) continue;
            string text = value[begin.Length..^end.Length].Trim();
            if (text.Length is > 0 and <= 25000 && !text.Contains('\0') &&
                !text.Contains("WORD_DRAFT_BEGIN", StringComparison.Ordinal) &&
                !text.Contains("WORD_DRAFT_END", StringComparison.Ordinal))
                yield return text;
        }
    }

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

    private static IEnumerable<string> FencedBlocks(string text, string language = "json")
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
            else if (line == "```" || line.Equals("```" + language, StringComparison.OrdinalIgnoreCase)) start = index + 1;
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
