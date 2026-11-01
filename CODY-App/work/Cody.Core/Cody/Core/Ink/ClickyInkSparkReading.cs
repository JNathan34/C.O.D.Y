using System.Collections.Generic;
using System.Linq;

namespace HeyClicky.Core.Ink;

public sealed record ClickyInkSparkReading
{
	public List<double> Values { get; }

	public List<string> Tokens { get; }

	public List<double>? PreviousValues { get; }

	public List<string> Labels { get; }

	private readonly List<string> previousTokens;

	public string? Last
	{
		get
		{
			if (Tokens.Count <= 0)
			{
				return null;
			}
			List<string> tokens = Tokens;
			return tokens[tokens.Count - 1];
		}
	}

	public string? PreviousLast
	{
		get
		{
			if (previousTokens.Count <= 0)
			{
				return null;
			}
			List<string> list = previousTokens;
			return list[list.Count - 1];
		}
	}

	public (string Text, double Value)? Step
	{
		get
		{
			if (Tokens.Count <= 1)
			{
				return null;
			}
			List<string> tokens = Tokens;
			string text = tokens[tokens.Count - 2];
			List<string> tokens2 = Tokens;
			return ClickyInkNumber.Difference(text, tokens2[tokens2.Count - 1]);
		}
	}

	public ClickyInkSparkReading(ClickyInkDocument.Block block)
	{
		string key = ((block["values"] != null) ? "values" : ((block["points"] != null) ? "points" : ((block["data"] != null) ? "data" : "series")));
		Tokens = ClickyInkSeries.Tokens(block[key]);
		Values = (from n in Tokens.Select(ClickyInkNumber.Parse)
			where n.HasValue
			select n.Value.Value).ToList();
		string text = ClickyInkChange.Previous(block, key);
		PreviousValues = ((text == null) ? null : ClickyInkSeries.Values(text));
		previousTokens = ((text == null) ? new List<string>() : ClickyInkSeries.Tokens(text));
		Labels = ClickyInkSeries.Labels(block["labels"]);
	}
}
