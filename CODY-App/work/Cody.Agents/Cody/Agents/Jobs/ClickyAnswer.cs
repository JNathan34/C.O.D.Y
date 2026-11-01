using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace HeyClicky.Agents.Jobs;

public sealed record ClickyAnswer
{
	public sealed record Number
	{
		[JsonPropertyName("value")]
		public required string Value { get; init; }

		[JsonPropertyName("label")]
		public string? Label { get; init; }

		[JsonPropertyName("was")]
		public string? Was { get; init; }

		[JsonPropertyName("of")]
		public string? Of { get; init; }

		[JsonPropertyName("better")]
		public string? Better { get; init; }
	}

	public sealed record Row
	{
		[JsonPropertyName("text")]
		public required string Text { get; init; }

		[JsonPropertyName("detail")]
		public string? Detail { get; init; }
	}

	public sealed record DoneRow
	{
		[JsonPropertyName("did")]
		public required string Did { get; init; }

		[JsonPropertyName("what")]
		public string? What { get; init; }

		[JsonPropertyName("link")]
		public string? Link { get; init; }
	}

	public sealed record Draft
	{
		[JsonPropertyName("text")]
		public required string Text { get; init; }

		[JsonPropertyName("to")]
		public string? To { get; init; }
	}

	public sealed record Choice
	{
		[JsonPropertyName("answer")]
		public string? Answer { get; init; }

		[JsonPropertyName("detail")]
		public string? Detail { get; init; }

		[JsonPropertyName("file")]
		public string? File { get; init; }

		[JsonIgnore]
		public string Reply
		{
			get
			{
				string? text = Answer;
				if (text == null)
				{
					string file = File;
					if (file == null)
					{
						return "";
					}
					text = Path.GetFileName(file);
				}
				return text;
			}
		}
	}

	public sealed record NextStep
	{
		[JsonPropertyName("label")]
		public required string Label { get; init; }

		[JsonPropertyName("open")]
		public required string Open { get; init; }
	}

	public enum NumbersLookKind
	{
		Hero,
		Tiles,
		Changes,
		Progress
	}

	public enum Block
	{
		Numbers,
		List,
		Done,
		Draft,
		Ask
	}

	[JsonPropertyName("line")]
	public required string Line { get; init; }

	[JsonPropertyName("numbers")]
	public IReadOnlyList<Number>? Numbers { get; init; }

	[JsonPropertyName("list")]
	public IReadOnlyList<Row>? List { get; init; }

	[JsonPropertyName("ranked")]
	public bool? Ranked { get; init; }

	[JsonPropertyName("done")]
	public IReadOnlyList<DoneRow>? Done { get; init; }

	[JsonPropertyName("draft")]
	public Draft? DraftText { get; init; }

	[JsonPropertyName("ask")]
	public IReadOnlyList<Choice>? Ask { get; init; }

	[JsonPropertyName("note")]
	public string? Note { get; init; }

	[JsonPropertyName("next")]
	public NextStep? Next { get; init; }

	[JsonPropertyName("quiet")]
	public bool? Quiet { get; init; }

	[JsonIgnore]
	public NumbersLookKind? NumbersLook
	{
		get
		{
			IReadOnlyList<Number> numbers = Numbers;
			if (numbers == null || numbers.Count <= 0)
			{
				return null;
			}
			if (numbers.Any((Number n) => n.Was != null))
			{
				return NumbersLookKind.Changes;
			}
			if (numbers.Any((Number n) => n.Of != null))
			{
				return NumbersLookKind.Progress;
			}
			return (numbers.Count != 1) ? NumbersLookKind.Tiles : NumbersLookKind.Hero;
		}
	}

	[JsonIgnore]
	public IReadOnlyList<Block> Blocks
	{
		get
		{
			if (Quiet == true)
			{
				return Array.Empty<Block>();
			}
			List<Block> list = new List<Block>();
			IReadOnlyList<Number> numbers = Numbers;
			if (numbers != null && numbers.Count > 0)
			{
				list.Add(Block.Numbers);
			}
			IReadOnlyList<Row> list2 = List;
			if (list2 != null && list2.Count > 0)
			{
				list.Add(Block.List);
			}
			IReadOnlyList<DoneRow> done = Done;
			if (done != null && done.Count > 0)
			{
				list.Add(Block.Done);
			}
			if ((object)DraftText != null)
			{
				list.Add(Block.Draft);
			}
			IReadOnlyList<Choice> ask = Ask;
			if (ask != null && ask.Count > 0)
			{
				list.Add(Block.Ask);
			}
			if (list.Count > 2 && list.Contains(Block.Ask))
			{
				return new _003C_003Ez__ReadOnlyArray<Block>(new Block[2]
				{
					list[0],
					Block.Ask
				});
			}
			if (list.Count > 2 && list.Contains(Block.Draft))
			{
				return new _003C_003Ez__ReadOnlyArray<Block>(new Block[2]
				{
					list[0],
					Block.Draft
				});
			}
			return list.Take(2).ToList();
		}
	}

	[JsonIgnore]
	public bool IsQuiet => Quiet == true;

	[JsonIgnore]
	public string? ReportJson
	{
		get
		{
			try
			{
				if (!(JsonSerializer.SerializeToNode(this, ReportJsonOptions) is JsonObject jsonObject))
				{
					return null;
				}
				jsonObject.Remove("line");
				jsonObject["outcome"] = Line;
				return Sorted(jsonObject).ToJsonString(ReportJsonOptions);
			}
			catch (Exception)
			{
				return null;
			}
		}
	}

	private static JsonSerializerOptions ReportJsonOptions => ReportJsonSettings;

	private static readonly JsonSerializerOptions ReportJsonSettings = new JsonSerializerOptions
	{
		DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
		Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
	};

	private static JsonNode Sorted(JsonNode node)
	{
		if (!(node is JsonObject source))
		{
			if (node is JsonArray source2)
			{
				return new JsonArray(source2.Select((JsonNode n) => (n != null) ? Sorted(n.DeepClone()) : null).ToArray());
			}
			return node.DeepClone();
		}
		return new JsonObject(from kv in source.OrderBy((KeyValuePair<string, JsonNode> kv) => kv.Key, StringComparer.Ordinal)
			select KeyValuePair.Create(kv.Key, (kv.Value == null) ? null : Sorted(kv.Value.DeepClone())));
	}

	public static ClickyAnswer? Parse(string? blockText)
	{
		string text = blockText?.Trim();
		if (string.IsNullOrEmpty(text))
		{
			return null;
		}
		if (text.StartsWith("```", StringComparison.Ordinal))
		{
			text = string.Join("\n", text.Split('\n').Skip(1));
			int num = text.LastIndexOf("```", StringComparison.Ordinal);
			if (num >= 0)
			{
				text = text.Substring(0, num);
			}
			text = text.Trim();
		}
		JsonObject jsonObject = null;
		if (text.StartsWith('{'))
		{
			int num2 = text.IndexOf('{');
			int num3 = text.LastIndexOf('}');
			if (num3 > num2)
			{
				try
				{
					string text2 = text;
					int num4 = num2;
					jsonObject = JsonNode.Parse(text2.Substring(num4, num3 + 1 - num4)) as JsonObject;
				}
				catch (JsonException)
				{
				}
			}
		}
		if (jsonObject == null)
		{
			string text3 = Clean(text, 220);
			if (text3.Length != 0 && !text3.Contains('{'))
			{
				return new ClickyAnswer
				{
					Line = text3
				};
			}
			return null;
		}
		string text4 = Clean(Str(jsonObject["outcome"]) ?? Str(jsonObject["line"]), 220);
		if (text4.Length == 0)
		{
			return null;
		}
		List<Number> list = Arr(jsonObject["numbers"]).Select((JsonNode any) =>
		{
			if (any is JsonObject jsonObject4)
			{
				string text10 = Fitting(jsonObject4["value"], 12);
				if (text10 != null)
				{
					string text11 = Str(jsonObject4["better"])?.ToLowerInvariant();
					Number number = new Number
					{
						Value = text10,
						Label = Optional(jsonObject4["label"], 32),
						Was = Fitting(jsonObject4["was"], 12),
						Of = Fitting(jsonObject4["of"], 12)
					};
					Number number2 = number;
					bool flag = ((text11 == "higher" || text11 == "lower") ? true : false);
					number2.Better = (flag ? text11 : null);
					return number;
				}
			}
			return (Number)null;
		}).OfType<Number>().ToList();
		List<Row> list2 = Arr(jsonObject["list"]).Select((JsonNode any) =>
		{
			if (!(any is JsonObject jsonObject4))
			{
				string text10 = Fitting(any, 56);
				if (text10 == null)
				{
					return (Row)null;
				}
				return new Row
				{
					Text = text10
				};
			}
			string text11 = Fitting(jsonObject4["text"], 56);
			return (text11 == null) ? null : new Row
			{
				Text = text11,
				Detail = Fitting(jsonObject4["detail"], 24)
			};
		}).OfType<Row>().ToList();
		List<DoneRow> list3 = Arr(jsonObject["done"]).Select((JsonNode any) =>
		{
			if (!(any is JsonObject jsonObject4))
			{
				string text10 = Fitting(any, 60);
				if (text10 == null)
				{
					return (DoneRow)null;
				}
				return new DoneRow
				{
					Did = text10
				};
			}
			string text11 = Fitting(jsonObject4["did"] ?? jsonObject4["text"], 60);
			return (text11 == null) ? null : new DoneRow
			{
				Did = text11,
				What = Fitting(jsonObject4["what"], 32),
				Link = Target(jsonObject4["link"])
			};
		}).OfType<DoneRow>().ToList();
		Draft draftText = null;
		if (jsonObject["draft"] is JsonObject jsonObject2)
		{
			string text5 = Str(jsonObject2["text"]);
			if (text5 != null)
			{
				string text6 = Cap(text5.Trim(), 8000);
				if (text6.Length > 0)
				{
					draftText = new Draft
					{
						Text = text6,
						To = Optional(jsonObject2["to"], 40)
					};
				}
				goto IL_02a8;
			}
		}
		string text7 = Str(jsonObject["draft"])?.Trim();
		if (text7 != null && text7.Length > 0)
		{
			draftText = new Draft
			{
				Text = Cap(text7, 8000)
			};
		}
		goto IL_02a8;
		IL_02a8:
		List<Choice> source = Arr(jsonObject["ask"]).Select((JsonNode any) =>
		{
			if (any is JsonObject jsonObject4)
			{
				string text10 = Target(jsonObject4["file"]);
				if (text10 != null && !text10.StartsWith("http", StringComparison.OrdinalIgnoreCase))
				{
					return new Choice
					{
						Answer = Fitting(jsonObject4["answer"], 40),
						Detail = Fitting(jsonObject4["detail"], 24),
						File = text10
					};
				}
				string text11 = Fitting(jsonObject4["answer"] ?? jsonObject4["text"], 40);
				if (text11 == null)
				{
					return (Choice)null;
				}
				return new Choice
				{
					Answer = text11,
					Detail = Fitting(jsonObject4["detail"], 24)
				};
			}
			string text12 = Fitting(any, 40);
			return (text12 == null) ? null : new Choice
			{
				Answer = text12
			};
		}).OfType<Choice>().ToList();
		List<Choice> list4 = source.Where((Choice c) => c.File != null).ToList();
		List<Choice> list5 = source.Where((Choice c) => c.File == null).ToList();
		IReadOnlyList<Choice> ask;
		if (list4.Count >= 2)
		{
			ask = list4.Take(3).ToList();
		}
		else
		{
			ask = ((list5.Count >= 2) ? list5.Take(4).ToList() : null);
		}
		NextStep next = null;
		if (jsonObject["next"] is JsonObject jsonObject3)
		{
			string text8 = Fitting(jsonObject3["label"], 26);
			if (text8 != null)
			{
				string text9 = Target(jsonObject3["open"] ?? jsonObject3["link"]);
				if (text9 != null)
				{
					next = new NextStep
					{
						Label = text8,
						Open = text9
					};
				}
			}
		}
		List<Row> list6 = ((list2.Count > 0) ? list2.Take(4).ToList() : null);
		bool value = default;
		bool value2 = default;
		return new ClickyAnswer
		{
			Line = text4,
			Numbers = ((list.Count > 0) ? list.Take(3).ToList() : null),
			List = list6,
			Ranked = (((list6 != null && jsonObject["ranked"] is JsonValue jsonValue && jsonValue.TryGetValue<bool>(out value)) & value) ? new bool?(true) : ((bool?)null)),
			Done = ((list3.Count > 0) ? list3.Take(3).ToList() : null),
			DraftText = draftText,
			Ask = ask,
			Note = Optional(jsonObject["note"], 100),
			Next = next,
			Quiet = (((jsonObject["quiet"] is JsonValue jsonValue2 && jsonValue2.TryGetValue<bool>(out value2)) & value2) ? new bool?(true) : ((bool?)null))
		};
	}

	private static string? Str(JsonNode? node)
	{
		if (!(node is JsonValue jsonValue))
		{
			return null;
		}
		if (jsonValue.TryGetValue<string>(out string value))
		{
			return value;
		}
		if (jsonValue.GetValueKind() == JsonValueKind.Number)
		{
			return jsonValue.ToJsonString();
		}
		return null;
	}

	private static IEnumerable<JsonNode?> Arr(JsonNode? node)
	{
		return (node as JsonArray) ?? new JsonArray();
	}

	private static string? Fitting(JsonNode? node, int max)
	{
		string text = Clean(Str(node), 10000);
		if (text.Length != 0 && text.Length <= max)
		{
			return text;
		}
		return null;
	}

	private static string? Optional(JsonNode? node, int max)
	{
		string text = Clean(Str(node), max);
		if (text.Length != 0)
		{
			return text;
		}
		return null;
	}

	private static string? Target(JsonNode? node)
	{
		string text = Str(node)?.Trim();
		if (string.IsNullOrEmpty(text))
		{
			return null;
		}
		string text2 = text.ToLowerInvariant();
		if (text2.StartsWith("https://", StringComparison.Ordinal) || text2.StartsWith("http://", StringComparison.Ordinal))
		{
			return text;
		}
		string text3;
		if (!text.StartsWith("~/", StringComparison.Ordinal) && !text.StartsWith("~\\", StringComparison.Ordinal))
		{
			text3 = text;
		}
		else
		{
			string folderPath = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
			string text4 = text;
			text3 = Path.Combine(folderPath, text4.Substring(2, text4.Length - 2));
		}
		string text5 = text3;
		if (!Path.IsPathFullyQualified(text5))
		{
			return null;
		}
		return text5;
	}

	public static string Clean(string? raw, int max)
	{
		string text = (raw ?? "").Replace("\n", " ").Replace("**", "").Replace("`", "")
			.Trim();
		while (text.Contains("  ", StringComparison.Ordinal))
		{
			text = text.Replace("  ", " ");
		}
		if (text.Length <= max)
		{
			return text;
		}
		string text2 = text.Substring(0, max);
		int num = text2.LastIndexOf(' ');
		return ((num >= 0) ? text2.Substring(0, num) : text2).Trim() + "…";
	}

	private static string Cap(string s, int n)
	{
		if (s.Length <= n)
		{
			return s;
		}
		return s.Substring(0, n);
	}
}
