using System;
using System.Collections.Generic;
using System.Linq;

namespace HeyClicky.Core.Ink;

public static class ClickyInkWordsExtensions
{
	public static double FinishOfWriting(this ClickyInkLiveNote.Words words, double time)
	{
		double? num = null;
		foreach (ClickyInkLiveNote.Segment segment in words.Segments)
		{
			double? num2 = null;
			InkRange? written = segment.Written;
			if (written.HasValue)
			{
				InkRange valueOrDefault = written.GetValueOrDefault();
				if (valueOrDefault.LowerBound >= time - 0.001)
				{
					num2 = valueOrDefault.UpperBound;
					goto IL_00a5;
				}
			}
			written = segment.Struck;
			if (written.HasValue)
			{
				InkRange valueOrDefault2 = written.GetValueOrDefault();
				if (valueOrDefault2.LowerBound >= time - 0.001)
				{
					num2 = valueOrDefault2.UpperBound;
				}
			}
			goto IL_00a5;
			IL_00a5:
			if (num2.HasValue)
			{
				double valueOrDefault3 = num2.GetValueOrDefault();
				if (!num.HasValue || valueOrDefault3 > num)
				{
					num = valueOrDefault3;
				}
			}
		}
		if (num.HasValue)
		{
			return num.GetValueOrDefault();
		}
		double? num3 = null;
		foreach (ClickyInkLiveNote.Segment segment2 in words.Segments)
		{
			InkRange? written = segment2.Written;
			if (written.HasValue)
			{
				InkRange valueOrDefault4 = written.GetValueOrDefault();
				if (!num3.HasValue || valueOrDefault4.UpperBound > num3)
				{
					num3 = valueOrDefault4.UpperBound;
				}
			}
		}
		return num3.GetValueOrDefault();
	}

	public static (ClickyInkLiveNote.Words Head, ClickyInkLiveNote.Words Tail)? Split(this ClickyInkLiveNote.Words words, string separator)
	{
		string text = string.Concat(words.Segments.Select((ClickyInkLiveNote.Segment s) => s.Text));
		int num = text.Find(separator);
		if (num < 0)
		{
			return null;
		}
		int to = text.Substring(0, num).CharacterCount();
		int num2 = text.Substring(0, num + separator.Length).CharacterCount();
		List<ClickyInkLiveNote.Segment> list = new List<ClickyInkLiveNote.Segment>();
		List<ClickyInkLiveNote.Segment> list2 = new List<ClickyInkLiveNote.Segment>();
		int num3 = 0;
		foreach (ClickyInkLiveNote.Segment segment4 in words.Segments)
		{
			ClickyInkLiveNote.Segment segment = segment4;
			string[] characters = segment.Text.Characters();
			int length = characters.Length;
			int start = num3;
			int end = num3 + length;
			num3 = end;
			ClickyInkLiveNote.Segment? segment2 = Piece(0, to);
			if (segment2.HasValue)
			{
				ClickyInkLiveNote.Segment valueOrDefault = segment2.GetValueOrDefault();
				list.Add(valueOrDefault);
			}
			segment2 = Piece(num2, int.MaxValue);
			if (segment2.HasValue)
			{
				ClickyInkLiveNote.Segment valueOrDefault2 = segment2.GetValueOrDefault();
				list2.Add(valueOrDefault2);
			}
			ClickyInkLiveNote.Segment? Piece(int from, int val)
			{
				int num4 = Math.Max(from, start);
				int num5 = Math.Min(val, end);
				if (num4 >= num5)
				{
					return null;
				}
				ClickyInkLiveNote.Segment segment3 = segment with
				{
					Text = string.Concat(characters[(num4 - start)..(num5 - start)])
				};
				InkRange? written = segment.Written;
				if (written.HasValue)
				{
					InkRange valueOrDefault3 = written.GetValueOrDefault();
					if (length > 0)
					{
						double num6 = valueOrDefault3.UpperBound - valueOrDefault3.LowerBound;
						double num7 = valueOrDefault3.LowerBound + num6 * (double)(num4 - start) / (double)length;
						double val2 = valueOrDefault3.LowerBound + num6 * (double)(num5 - start) / (double)length;
						segment3 = segment3 with
						{
							Written = new InkRange(num7, Math.Max(num7, val2))
						};
					}
				}
				return segment3;
			}
		}
		return (new ClickyInkLiveNote.Words(list), new ClickyInkLiveNote.Words(list2));
	}
}
