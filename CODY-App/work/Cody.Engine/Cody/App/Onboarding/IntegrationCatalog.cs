using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using HeyClicky.App.Wiring;

namespace HeyClicky.App.Onboarding;

public static class IntegrationCatalog
{
	public sealed record Apps(IReadOnlyList<string> All, IReadOnlyList<string> ConnectedLines);

	public static async Task<Apps> FetchAsync(RealStack real)
	{
		try
		{
			JsonObject n = await real.Core.Worker.GetJsonObjectAsync("/agent/integrations");
			List<string> all = new List<string>();
			List<string> connected = new List<string>();
			Walk(n);
			return new Apps(all.Distinct().Take(80).ToList(), connected.Distinct().ToList());
			void Walk(JsonNode? jsonNode)
			{
				if (jsonNode is JsonObject jsonObject)
				{
					if (!(jsonObject["display_name"] is JsonValue jsonValue) || !jsonValue.TryGetValue<string>(out string value) || value.Length <= 0)
					{
						foreach (KeyValuePair<string, JsonNode> item in jsonObject)
						{
							Walk(item.Value);
						}
						return;
					}
					all.Add(value);
					string text = ((jsonObject["status"] is JsonValue jsonValue2 && jsonValue2.TryGetValue<string>(out string value2)) ? value2 : "");
					if ((text == "connected" || text == "partial") ? true : false)
					{
						string text2 = ((jsonObject["description"] is JsonValue jsonValue3 && jsonValue3.TryGetValue<string>(out string value3)) ? value3.Trim() : "");
						connected.Add((text2.Length == 0) ? value : (value + ": " + text2));
					}
				}
				else if (jsonNode is JsonArray jsonArray)
				{
					foreach (JsonNode item2 in jsonArray)
					{
						Walk(item2);
					}
				}
			}
		}
		catch (Exception ex)
		{
			Log.Warn("integrations", "catalog: " + ex.Message);
			return new Apps(Array.Empty<string>(), Array.Empty<string>());
		}
	}
}
