using System.Text.Json.Nodes;

namespace HeyClicky.App.Demo;

public static class ReferralFixture
{
	internal static JsonObject ReferralBody(bool earned)
	{
		JsonObject jsonObject = new JsonObject
		{
			["enabled"] = true,
			["code"] = "nilesh",
			["share_url"] = "https://heyclicky.com/@nilesh",
			["share_display_text"] = "heyclicky.com/@nilesh",
			["share_display_prefix"] = "heyclicky.com/@",
			["is_code_disabled"] = false,
			["terms"] = new JsonObject
			{
				["commission_percent"] = 25,
				["commission_months"] = 12,
				["customer_discount_percent"] = 50,
				["customer_discount_months"] = 1,
				["commission_hold_days"] = 30,
				["minimum_payout_usd_cents"] = 2500,
				["payout_contact_email"] = "hi@heyclicky.com"
			},
			["stats"] = (earned ? new JsonObject
			{
				["referred_count"] = 2,
				["paying_count"] = 1,
				["earned_usd_cents"] = 6500,
				["available_usd_cents"] = 4000,
				["on_hold_usd_cents"] = 2500,
				["paid_out_usd_cents"] = 0,
				["earned_last_30_days_usd_cents"] = 2500
			} : new JsonObject
			{
				["referred_count"] = 0,
				["paying_count"] = 0,
				["earned_usd_cents"] = 0,
				["available_usd_cents"] = 0,
				["on_hold_usd_cents"] = 0,
				["paid_out_usd_cents"] = 0
			})
		};
		JsonObject jsonObject2 = new JsonObject
		{
			["max_referrals_per_month"] = 50,
			["default_months_retained"] = 6
		};
		_003C_003Ey__InlineArray2<JsonNode> buffer = default;
		buffer[0] = new JsonObject
		{
			["key"] = "pro",
			["name"] = "Pro",
			["monthly_price_usd_cents"] = 2000,
			["default_referrals_per_month"] = 3
		};
		buffer[1] = new JsonObject
		{
			["key"] = "max",
			["name"] = "Max",
			["monthly_price_usd_cents"] = 10000,
			["default_referrals_per_month"] = 1
		};
		jsonObject2["plans"] = new JsonArray(buffer);
		jsonObject["estimator"] = jsonObject2;
		JsonArray value;
		if (!earned)
		{
			value = new JsonArray();
		}
		else
		{
			_003C_003Ey__InlineArray2<JsonNode> buffer2 = default;
			buffer2[0] = new JsonObject
			{
				["display_name"] = "Sam",
				["plan"] = "max",
				["subscribed_months"] = 2,
				["earned_usd_cents"] = 5000,
				["joined_at"] = "2026-08-02T10:00:00Z"
			};
			buffer2[1] = new JsonObject
			{
				["display_name"] = "Ada",
				["plan"] = "pro",
				["subscribed_months"] = 3,
				["earned_usd_cents"] = 1500,
				["joined_at"] = "2026-07-12T10:00:00Z"
			};
			value = new JsonArray(buffer2);
		}
		jsonObject["invited_friends"] = value;
		jsonObject["monthly_earnings"] = new JsonArray();
		return jsonObject;
	}
}
