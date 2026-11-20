using System;
using System.Text.Json;
using HeyClicky.App.Cody;

int checks = 0;
string plan = """{"steps":[{"type":"paragraph","text":"Hello, I am C.O.D.Y.","style":"normal"}]}""";
string Say(string text) => "say(" + JsonSerializer.Serialize(text) + ");";
void Accept(string raw)
{
    checks++;
    if (!CodyWordPlanReply.TryParse(raw, out var parsed) ||
        !System.Text.Json.Nodes.JsonNode.DeepEquals(System.Text.Json.Nodes.JsonNode.Parse(parsed.GetRawText()), System.Text.Json.Nodes.JsonNode.Parse(plan)))
        throw new Exception("Failed to decode expected plan: " + raw);
}
void Reject(string raw)
{
    checks++;
    if (CodyWordPlanReply.TryParse(raw, out _)) throw new Exception("Accepted invalid or ambiguous reply: " + raw);
}
Accept(plan);
Accept("```json\n" + plan + "\n```");
Accept("Here is the plan:\n```json\r\n" + plan + "\r\n```\nReady.");
Accept(Say(plan));
Accept(Say("I will write an introduction.") + Say(plan) + Say("Ready to apply."));
Accept(Say(plan) + Say(plan));
Accept(Say("```json\n" + plan + "\n```"));
Accept(Say("{\"steps\":[") + Say("{\"type\":\"paragraph\",\"text\":\"Hello, I am C.O.D.Y.\",\"style\":\"normal\"}") + Say("]}"));
// The raw JSON must win over incidental say() examples in the document prose.
string original = plan;
plan = JsonSerializer.Serialize(new { steps = new[] { new { type = "paragraph", text = "Example: say(\"hello\"); and ```json { braces }" } } });
Accept(plan);
plan = original;
foreach (string raw in new[] { "", "I updated Word.", "{}", "[]", "{\"steps\":", "{\"steps\":\"bad\"}",
    "{\"question\":\"\"}", "{\"steps\":[],\"question\":\"What topic?\"}",
    Say(plan) + Say("{\"question\":\"What topic?\"}"),
    "```json\n" + plan, "say(" + JsonSerializer.Serialize(plan)[..^1],
    "run_code(\"write to Word\");" }) Reject(raw);
foreach (string field in new[] { "question", "answer", "unsupported" })
{
    checks++;
    if (!CodyWordPlanReply.TryParse(JsonSerializer.Serialize(new System.Collections.Generic.Dictionary<string, string> { [field] = "Response" }), out _))
        throw new Exception("Failed to decode " + field);
}

var host = new AppHost();
host.Real.Core.BrainClient.Replies.Enqueue(Say("I can help with that."));
host.Real.Core.BrainClient.Replies.Enqueue(Say("Here is the introduction.") + Say(plan));
var result = await CodyWordPlan.Generate(host, "Introduce yourself in this Word document", "{}", "[]");
checks++;
if (result.GetRawText() != plan || host.Real.Core.BrainClient.Calls != 2) throw new Exception("Invalid reply was not retried once.");
host.Real.Core.BrainClient.Replies.Enqueue("Not a plan");
host.Real.Core.BrainClient.Replies.Enqueue("Still not a plan");
try { await CodyWordPlan.Generate(host, "Write something", "{}", "[]"); throw new Exception("Invalid replies accepted"); }
catch (InvalidOperationException error) when (error.Message.Contains("left unchanged")) { checks++; }
// A failed attempt must release the pending request, so subsequent requests work.
host.Real.Core.BrainClient.Replies.Enqueue(plan);
await CodyWordPlan.Generate(host, "Introduce yourself", "{}", "[]");
checks++;
host.Real.Core.BrainClient.Error = "Service unavailable";
int before = host.Real.Core.BrainClient.Calls;
host.Real.Core.BrainClient.Replies.Enqueue("");
try { await CodyWordPlan.Generate(host, "Write something", "{}", "[]"); throw new Exception("Service error hidden"); }
catch (InvalidOperationException error) when (error.Message.Contains("Service unavailable"))
{
    checks++;
    if (host.Real.Core.BrainClient.Calls != before + 1) throw new Exception("Service error retried");
}
Console.WriteLine($"{checks} Word reply and retry checks passed.");

const string draft = "WORD_DRAFT_BEGIN\nThe first paragraph.\n\nThe second paragraph.\nWORD_DRAFT_END";
host.Real.Core.BrainClient.Error = null;
host.Real.Core.BrainClient.Replies.Enqueue(Say("I can write a draft."));
host.Real.Core.BrainClient.Replies.Enqueue("```js\n" + Say("Here is the draft.") + Say(draft) + "\n```");
var originalProse = await CodyWordPlan.Generate(host, "Draft a note about gardening in Word", "{}", "[]", insertOnly: true);
var draftSteps = originalProse.GetProperty("steps");
if (draftSteps.GetArrayLength() != 2 ||
    draftSteps[0].GetProperty("text").GetString() != "The first paragraph." ||
    draftSteps[1].GetProperty("text").GetString() != "The second paragraph." ||
    draftSteps[1].GetProperty("type").GetString() != "paragraph")
    throw new Exception("Word did not receive just the prose as two paragraphs.");
foreach (string invalid in new[] { Say("I can help"), draft[..^4], Say(draft) + Say(draft.Replace("first", "other")), plan })
    if (CodyWordPlanReply.TryParseDraft(invalid, out _)) throw new Exception("Accepted an incomplete or ambiguous prose draft.");
Console.WriteLine("Word prose drafting and invalid-reply checks passed.");
