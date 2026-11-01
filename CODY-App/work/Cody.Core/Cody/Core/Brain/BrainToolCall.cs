using System.Text.Json;

namespace HeyClicky.Core.Brain;

public sealed record BrainToolCall(string CallId, string Name, string Arguments, bool IsAsync)
{
	public static BrainToolCall? FromEvent(JsonElement call)
	{
		if (call.ValueKind != JsonValueKind.Object)
		{
			return null;
		}
		if (!call.TryGetProperty("call_id", out var value) || value.ValueKind != JsonValueKind.String)
		{
			return null;
		}
		if (!call.TryGetProperty("name", out var value2) || value2.ValueKind != JsonValueKind.String)
		{
			return null;
		}
		string arguments = ((call.TryGetProperty("arguments", out var value3) && value3.ValueKind == JsonValueKind.String) ? value3.GetString() : "{}");
		bool isAsync = call.TryGetProperty("async", out var value4) && value4.ValueKind == JsonValueKind.True;
		return new BrainToolCall(value.GetString(), value2.GetString(), arguments, isAsync);
	}
}
