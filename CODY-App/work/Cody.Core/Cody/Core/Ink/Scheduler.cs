using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;

namespace HeyClicky.Core.Ink;

internal sealed class Scheduler
{
	private readonly record struct Token(string Text, ClickyInkLiveNote.Segment Segment);

	public double Cursor;

	public readonly double Arrival;

	public readonly int? Edit;

	private readonly double haste;

	public double? FoldTime;

	public bool IsPartial;

	public (int Page, int Block)? Position;

	public (int Page, int Block)? LastWorked;

	private bool IsJumpToPosition
	{
		get
		{
			int? edit = Edit;
			if (edit.HasValue && !IsPartial)
			{
				(int, int)? position = Position;
				if (position.HasValue)
				{
					(int, int) valueOrDefault = position.GetValueOrDefault();
					position = LastWorked;
					if (position.HasValue)
					{
						(int, int) valueOrDefault2 = position.GetValueOrDefault();
						if (Math.Abs(valueOrDefault.Item1 - valueOrDefault2.Item1) >= 2)
						{
							return true;
						}
						if (valueOrDefault.Item1 == valueOrDefault2.Item1)
						{
							return Math.Abs(valueOrDefault.Item2 - valueOrDefault2.Item2) >= 4;
						}
						return false;
					}
				}
			}
			return false;
		}
	}

	public Scheduler(double cursor, double arrival, int? edit, double haste)
	{
		Cursor = cursor;
		Arrival = arrival;
		Edit = edit;
		this.haste = Math.Max(0.6, haste);
	}

	public void Pause(double seconds)
	{
		Spend(seconds);
	}

	private InkRange Spend(double seconds)
	{
		double cursor = Cursor;
		Cursor += seconds / haste;
		return new InkRange(cursor, Cursor);
	}

	private void SpendMotion(double seconds)
	{
		Cursor += seconds / Math.Min(haste, 1.6);
	}

	public ClickyInkLiveNote.Words Written(string text, double pace)
	{
		if (text.Length == 0)
		{
			return ClickyInkLiveNote.Words.Empty;
		}
		InkRange? written = Spend(ClickyInkPen.Beats(text) / pace);
		int? edit = Edit;
		bool isPartial = IsPartial;
		return new ClickyInkLiveNote.Words(new _003C_003Ez__ReadOnlySingleElementList<ClickyInkLiveNote.Segment>(new ClickyInkLiveNote.Segment(text, written, null, null, edit, null, isPartial)));
	}

	public ClickyInkLiveNote.Words Rewrite(ClickyInkLiveNote.Words? old, string text, double pace)
	{
		if ((object)old == null || old.Segments.Count == 0)
		{
			return Written(text, pace);
		}
		List<ClickyInkLiveNote.Segment> list = old.Segments.Select((ClickyInkLiveNote.Segment segment5) =>
		{
			if (segment5.Struck.HasValue && !segment5.VanishesAt.HasValue)
			{
				int? edit2 = Edit;
				if (!edit2.HasValue || segment5.StruckInEdit != Edit)
				{
					return segment5 with
					{
						VanishesAt = Arrival
					};
				}
			}
			return segment5;
		}).ToList();
		if (old.Current == text)
		{
			return new ClickyInkLiveNote.Words(list);
		}
		if (ClickyInkParser.Emphasis.Strip(old.Current) == ClickyInkParser.Emphasis.Strip(text))
		{
			List<ClickyInkLiveNote.Segment> list2 = list.Where((ClickyInkLiveNote.Segment s) => !s.Struck.HasValue && !s.VanishesAt.HasValue).ToList();
			if (list2.Count == 1)
			{
				list2[0] = list2[0] with
				{
					Text = text
				};
				List<ClickyInkLiveNote.Segment> list3 = new List<ClickyInkLiveNote.Segment>();
				list3.AddRange(list2);
				list3.AddRange(list.Where((ClickyInkLiveNote.Segment s) => s.VanishesAt.HasValue));
				return new ClickyInkLiveNote.Words(new _003C_003Ez__ReadOnlyList<ClickyInkLiveNote.Segment>(list3));
			}
		}
		List<Token> list4 = new List<Token>();
		Dictionary<int, List<ClickyInkLiveNote.Segment>> attachments = new Dictionary<int, List<ClickyInkLiveNote.Segment>>();
		foreach (ClickyInkLiveNote.Segment item2 in list)
		{
			if (item2.VanishesAt.HasValue || item2.Struck.HasValue)
			{
				Attach(list4.Count - 1, item2);
				continue;
			}
			List<string> list5 = ClickyInkMatch.Tokens(item2.Text);
			List<double> list6 = ClickyInkPen.CumulativeBeats(item2.Text);
			double val;
			if (list6.Count <= 0)
			{
				val = 0.0;
			}
			else
			{
				val = list6[list6.Count - 1];
			}
			double num = Math.Max(val, 1E-06);
			int num2 = 0;
			foreach (string item3 in list5)
			{
				ClickyInkLiveNote.Segment segment = item2 with
				{
					Text = item3
				};
				int num3 = item3.CharacterCount();
				InkRange? written = item2.Written;
				if (written.HasValue)
				{
					InkRange valueOrDefault = written.GetValueOrDefault();
					double num4 = valueOrDefault.UpperBound - valueOrDefault.LowerBound;
					double num5 = valueOrDefault.LowerBound + num4 * list6[num2] / num;
					double val2 = valueOrDefault.LowerBound + num4 * list6[Math.Min(list6.Count - 1, num2 + num3)] / num;
					segment = segment with
					{
						Written = new InkRange(num5, Math.Max(num5, val2))
					};
				}
				num2 += num3;
				list4.Add(new Token(item3, segment));
			}
		}
		List<(string, ClickyInkMatch.Change)> list7 = ClickyInkMatch.Lcs(list4.Select((Token t) => t.Text).ToList(), ClickyInkMatch.Tokens(text));
		if (IsPartial)
		{
			int num6 = 0;
			foreach (var item4 in list7)
			{
				ClickyInkMatch.Change item = item4.Item2;
				if (item != ClickyInkMatch.Change.Added)
				{
					if (item == ClickyInkMatch.Change.Removed && !list4[num6].Segment.IsPreview)
					{
						return new ClickyInkLiveNote.Words(list);
					}
					num6++;
				}
			}
		}
		int? edit = Edit;
		if (edit.HasValue && !IsPartial && IsHeavyRewrite(list4.Select((Token t) => (Text: t.Text, IsPreview: t.Segment.IsPreview)).ToList(), list7, text))
		{
			List<ClickyInkLiveNote.Segment> list8 = new List<ClickyInkLiveNote.Segment>(Attached(-1));
			int num7 = list4.Where((Token t) => !t.Segment.IsPreview && !InkText.AllWhitespace(t.Text)).Sum((Token t) => t.Text.CharacterCount());
			double num8 = Math.Min(0.8, Math.Max(0.3, (double)num7 / 90.0));
			for (int num9 = 0; num9 < list4.Count; num9++)
			{
				Token token = list4[num9];
				ClickyInkLiveNote.Segment segment2 = token.Segment;
				if (segment2.IsPreview || InkText.AllWhitespace(token.Text))
				{
					segment2.VanishesAt = Cursor;
				}
				else
				{
					segment2.Struck = Spend(num8 * (double)token.Text.CharacterCount() / (double)Math.Max(1, num7));
					segment2.StruckInEdit = Edit;
				}
				list8.Add(segment2);
				list8.AddRange(Attached(num9));
			}
			int num10 = list8.FindLastIndex((ClickyInkLiveNote.Segment s) => !s.VanishesAt.HasValue);
			if (num10 >= 0 && !list8[num10].Text.HasSuffix(" "))
			{
				list8[num10] = list8[num10] with
				{
					Text = list8[num10].Text + " "
				};
			}
			InkRange? written2 = Spend(ClickyInkPen.Beats(text) / pace);
			edit = Edit;
			list8.Add(new ClickyInkLiveNote.Segment(text, written2, null, null, edit));
			return new ClickyInkLiveNote.Words(ClickyInkMatch.Merged(list8));
		}
		List<ClickyInkLiveNote.Segment> list9 = new List<ClickyInkLiveNote.Segment>(Attached(-1));
		int num11 = 0;
		foreach (var item5 in list7)
		{
			var (text2, _) = item5;
			switch (item5.Item2)
			{
			case ClickyInkMatch.Change.Kept:
			{
				ClickyInkLiveNote.Segment segment3 = list4[num11].Segment;
				segment3.Text = ((segment3.Text.HasSuffix(" ") && !text2.HasSuffix(" ")) ? (text2 + " ") : text2);
				if (!IsPartial)
				{
					segment3.IsPreview = false;
				}
				list9.Add(segment3);
				list9.AddRange(Attached(num11));
				num11++;
				break;
			}
			case ClickyInkMatch.Change.Removed:
			{
				if (list4[num11].Segment.IsPreview)
				{
					Token token2 = list4[num11];
					list9.Add(token2.Segment with
					{
						VanishesAt = Cursor
					});
					list9.AddRange(Attached(num11));
					num11++;
					break;
				}
				if (IsPartial)
				{
					list9.Add(list4[num11].Segment);
					list9.AddRange(Attached(num11));
					num11++;
					break;
				}
				ClickyInkLiveNote.Segment segment4 = list4[num11].Segment;
				edit = Edit;
				if (edit.HasValue && !InkText.AllWhitespace(text2))
				{
					segment4.Struck = Spend(0.3 * Math.Min(1.0, (double)text2.CharacterCount() / 6.0 + 0.3));
					segment4.StruckInEdit = Edit;
				}
				else
				{
					segment4.VanishesAt = Cursor;
				}
				list9.Add(segment4);
				list9.AddRange(Attached(num11));
				num11++;
				break;
			}
			case ClickyInkMatch.Change.Added:
			{
				int num12 = list9.FindLastIndex((ClickyInkLiveNote.Segment s) => !s.VanishesAt.HasValue);
				bool num13 = !text2.HasPrefix(" ") && num12 >= 0 && !list9[num12].Text.HasSuffix(" ") && list9[num12].Text.Length > 0;
				string text3 = text2;
				if (num13)
				{
					if (list9[num12].Struck.HasValue)
					{
						list9[num12] = list9[num12] with
						{
							Text = list9[num12].Text + " "
						};
					}
					else
					{
						text3 = " " + text2;
					}
				}
				string text4 = text3;
				InkRange? written3 = Spend(ClickyInkPen.Beats(text3) / pace);
				edit = Edit;
				bool isPartial = IsPartial;
				list9.Add(new ClickyInkLiveNote.Segment(text4, written3, null, null, edit, null, isPartial));
				break;
			}
			}
		}
		return new ClickyInkLiveNote.Words(ClickyInkMatch.Merged(list9));
		void Attach(int index, ClickyInkLiveNote.Segment item2)
		{
			if (!attachments.TryGetValue(index, out List<ClickyInkLiveNote.Segment> value))
			{
				value = (attachments[index] = new List<ClickyInkLiveNote.Segment>());
			}
			value.Add(item2);
		}
		IEnumerable<ClickyInkLiveNote.Segment> Attached(int index)
		{
			if (!attachments.TryGetValue(index, out List<ClickyInkLiveNote.Segment> value))
			{
				return new List<ClickyInkLiveNote.Segment>();
			}
			return value;
		}
	}

	public ClickyInkLiveNote.Block Write(ClickyInkDocument.Block block, string id)
	{
		(int, int)? position = Position;
		if (position.HasValue)
		{
			(int, int) valueOrDefault = position.GetValueOrDefault();
			LastWorked = valueOrDefault;
		}
		Spend(0.1);
		double cursor = Cursor;
		if (IsObject(block.Kind))
		{
			SpendMotion(0.55);
		}
		else
		{
			SpendMotion(0.13999999999999999);
		}
		ClickyInkLiveNote.Words words = Written(block.Text, Pace(block.Kind));
		List<ClickyInkLiveNote.Item> items = block.Items.Select((ClickyInkDocument.Item item, int value) => WriteItem(item, $"{id}-i{value}", block.Kind)).ToList();
		string id2 = id;
		int num = 1;
		List<ClickyInkLiveNote.Stamp<ClickyInkDocument.Block>> list = new List<ClickyInkLiveNote.Stamp<ClickyInkDocument.Block>>(num);
		CollectionsMarshal.SetCount(list, num);
		Span<ClickyInkLiveNote.Stamp<ClickyInkDocument.Block>> span = CollectionsMarshal.AsSpan(list);
		int index = 0;
		span[index] = new ClickyInkLiveNote.Stamp<ClickyInkDocument.Block>(cursor, block, Edit);
		return new ClickyInkLiveNote.Block(id2, list, words, items, cursor, Edit)
		{
			IsPreview = IsPartial
		};
	}

	public ClickyInkLiveNote.Item WriteItem(ClickyInkDocument.Item item, string id, ClickyInkDocument.Kind kind)
	{
		double cursor = Cursor;
		SpendMotion(0.1);
		int num;
		List<ClickyInkLiveNote.Words> list;
		if (UsesCells(kind))
		{
			num = ((item.Cells.Count > 0) ? 1 : 0);
			if (num != 0)
			{
				list = item.Cells.Select((string c) => Written(c, 80.0)).ToList();
				goto IL_0055;
			}
		}
		else
		{
			num = 0;
		}
		list = new List<ClickyInkLiveNote.Words>();
		goto IL_0055;
		IL_0055:
		List<ClickyInkLiveNote.Words> cells = list;
		ClickyInkLiveNote.Words words = ((num != 0) ? ClickyInkLiveNote.Words.Plain(item.Text) : Written(item.Text, 48.0));
		string detail = item.Detail;
		ClickyInkLiveNote.Words detail2 = ((detail != null) ? Written(detail, 86.4) : null);
		int num2 = 1;
		List<ClickyInkLiveNote.Stamp<ClickyInkDocument.Item>> list2 = new List<ClickyInkLiveNote.Stamp<ClickyInkDocument.Item>>(num2);
		CollectionsMarshal.SetCount(list2, num2);
		Span<ClickyInkLiveNote.Stamp<ClickyInkDocument.Item>> span = CollectionsMarshal.AsSpan(list2);
		int index = 0;
		span[index] = new ClickyInkLiveNote.Stamp<ClickyInkDocument.Item>(cursor, item, Edit);
		return new ClickyInkLiveNote.Item(id, list2, words, cells, detail2, cursor)
		{
			IsPreview = IsPartial
		};
	}

	public ClickyInkLiveNote.Block Update(ClickyInkLiveNote.Block old, ClickyInkDocument.Block block)
	{
		ClickyInkLiveNote.Block block2 = old.Clone();
		if (!IsPartial)
		{
			block2.IsPreview = false;
		}
		double cursor = Cursor;
		try
		{
			if (old.Source != block && IsJumpToPosition)
			{
				block2.PenArrivals.Add(Cursor);
				SpendMotion(0.8);
			}
			if (old.Source != block)
			{
				block2.Stamps.Add(new ClickyInkLiveNote.Stamp<ClickyInkDocument.Block>(Cursor, block, Edit));
			}
			string[] array = new string[2] { "big", "value" };
			foreach (string key in array)
			{
				string text = old.Source[key];
				if (text != null)
				{
					string text2 = block[key];
					if (text2 != null && text != text2)
					{
						Spend(0.45);
						break;
					}
				}
			}
			block2.Words = Rewrite(old.Words, block.Text, Pace(block.Kind));
			HashSet<string> hashSet = new HashSet<string>();
			List<ClickyInkLiveNote.Item> list = new List<ClickyInkLiveNote.Item>();
			List<ClickyInkLiveNote.Item> list2 = old.Items.Where((ClickyInkLiveNote.Item item5) => !item5.GoneAt.HasValue && !item5.VanishesAt.HasValue).ToList();
			Dictionary<int, ClickyInkLiveNote.Item> dictionary = new Dictionary<int, ClickyInkLiveNote.Item>();
			for (int num = 0; num < block.Items.Count; num++)
			{
				ClickyInkDocument.Item item = block.Items[num];
				(ClickyInkLiveNote.Item, double)? tuple = null;
				foreach (ClickyInkLiveNote.Item item5 in list2)
				{
					if (!hashSet.Contains(item5.Id))
					{
						double num2 = ClickyInkMatch.Similarity(item5.Source.Text, item.Text);
						if (item5.Source.Cells.Count > 0 && item.Cells.Count > 0 && item5.Source.Cells[0] == item.Cells[0])
						{
							num2 += 0.3;
						}
						if (num2 > (tuple?.Item2 ?? 0.4))
						{
							tuple = (item5, num2);
						}
					}
				}
				if (tuple.HasValue)
				{
					(ClickyInkLiveNote.Item, double) valueOrDefault = tuple.GetValueOrDefault();
					(dictionary[num], _) = valueOrDefault;
					hashSet.Add(valueOrDefault.Item1.Id);
				}
			}
			if (!UsesCells(block.Kind))
			{
				for (int num3 = 0; num3 < block.Items.Count; num3++)
				{
					if (!dictionary.ContainsKey(num3) && num3 < list2.Count && !hashSet.Contains(list2[num3].Id))
					{
						dictionary[num3] = list2[num3];
						hashSet.Add(list2[num3].Id);
					}
				}
			}
			for (int num4 = 0; num4 < block.Items.Count; num4++)
			{
				ClickyInkDocument.Item item2 = block.Items[num4];
				if (dictionary.TryGetValue(num4, out var match))
				{
					ClickyInkLiveNote.Item item3 = match.Clone();
					if (!IsPartial)
					{
						item3.IsPreview = false;
					}
					if (match.Source != item2)
					{
						item3.Stamps.Add(new ClickyInkLiveNote.Stamp<ClickyInkDocument.Item>(Cursor, item2, Edit));
						if (match.Source.IsChecked != item2.IsChecked || match.Source.Mark != item2.Mark)
						{
							Spend(0.3);
						}
					}
					if (UsesCells(block.Kind) && item2.Cells.Count > 0 && match.Cells.Count > 0)
					{
						item3.Cells = item2.Cells.Select((string cell, int cellIndex) => (cellIndex >= match.Cells.Count) ? Written(cell, 80.0) : Rewrite(match.Cells[cellIndex], cell, 80.0)).ToList();
						item3.Words = ClickyInkLiveNote.Words.Plain(item2.Text);
					}
					else
					{
						item3.Words = Rewrite(match.Words, item2.Text, 48.0);
					}
					string detail = item2.Detail;
					if (detail != null)
					{
						item3.Detail = Rewrite(match.Detail, detail, 86.4);
					}
					list.Add(item3);
				}
				else
				{
					list.Add(WriteItem(item2, $"{old.Id}-e{Edit.GetValueOrDefault()}-{InkText.DoubleDescription(Cursor)}-i{num4}", block.Kind));
				}
			}
			string previousId = null;
			foreach (ClickyInkLiveNote.Item item6 in old.Items)
			{
				try
				{
					if (hashSet.Contains(item6.Id))
					{
						continue;
					}
					ClickyInkLiveNote.Item item4 = item6;
					if (IsPartial && !item6.GoneAt.HasValue && !item6.VanishesAt.HasValue)
					{
						int val = ItemPositionAfter(list, previousId) ?? list.Count;
						list.Insert(Math.Min(val, list.Count), item4);
						continue;
					}
					if (item6.GoneAt.HasValue || item6.VanishesAt.HasValue)
					{
						int? edit = Edit;
						bool flag = edit.HasValue && item6.GoneInEdit == Edit;
						if (!item4.VanishesAt.HasValue && !flag)
						{
							item4 = item4.Clone();
							item4.VanishesAt = Arrival;
						}
					}
					else
					{
						int? edit2 = Edit;
						if (!edit2.HasValue || item6.IsPreview)
						{
							item4 = item4.Clone();
							item4.VanishesAt = Cursor;
						}
						else
						{
							item4 = item4.Clone();
							item4.GoneAt = Spend(0.3).LowerBound;
							item4.GoneInEdit = Edit;
						}
					}
					int valueOrDefault2 = ItemPositionAfter(list, previousId).GetValueOrDefault();
					list.Insert(Math.Min(valueOrDefault2, list.Count), item4);
				}
				finally
				{
					previousId = item6.Id;
				}
			}
			block2.Items = list;
			return block2;
		}
		finally
		{
			if (Cursor > cursor)
			{
				(int, int)? position = Position;
				if (position.HasValue)
				{
					(int, int) valueOrDefault3 = position.GetValueOrDefault();
					LastWorked = valueOrDefault3;
				}
			}
		}
	}

	private static int? ItemPositionAfter(List<ClickyInkLiveNote.Item> items, string? previousId)
	{
		if (previousId == null)
		{
			return null;
		}
		int num = items.FindIndex((ClickyInkLiveNote.Item i) => i.Id == previousId);
		if (num >= 0)
		{
			return num + 1;
		}
		return null;
	}

	public ClickyInkLiveNote.Block Strike(ClickyInkLiveNote.Block old)
	{
		ClickyInkLiveNote.Block block = old.Clone();
		int? edit = Edit;
		if (!edit.HasValue || old.IsPreview)
		{
			block.VanishesAt = FoldTime ?? Cursor;
			return block;
		}
		block.GoneAt = Spend(0.3).LowerBound;
		block.GoneInEdit = Edit;
		ClickyInkDocument.Kind kind = old.Source.Kind;
		if ((kind == ClickyInkDocument.Kind.Checklist || (uint)(kind - 21) <= 1u || kind == ClickyInkDocument.Kind.Quiet) ? true : false)
		{
			block.VanishesAt = block.GoneAt;
		}
		return block;
	}

	public static bool IsHeavyRewrite(List<(string Text, bool IsPreview)> tokens, List<(string Piece, ClickyInkMatch.Change Change)> diff, string text)
	{
		string text2 = string.Concat(from t in tokens
			where !t.IsPreview
			select t.Text);
		if (ClickyInkMatch.Words(text2).Count < 5)
		{
			return false;
		}
		if (ClickyInkMatch.Similarity(text2, text) < 0.3)
		{
			return true;
		}
		int num = 0;
		bool flag = false;
		int num2 = 0;
		foreach (var item in diff)
		{
			switch (item.Change)
			{
			case ClickyInkMatch.Change.Kept:
				flag = false;
				break;
			case ClickyInkMatch.Change.Removed:
			{
				(string, bool) tuple = tokens[num2];
				if (!tuple.Item2 && !InkText.AllWhitespace(tuple.Item1))
				{
					if (!flag)
					{
						num++;
					}
					flag = true;
				}
				break;
			}
			case ClickyInkMatch.Change.Added:
				continue;
			}
			num2++;
		}
		return num >= 3;
	}

	public static bool UsesCells(ClickyInkDocument.Kind kind)
	{
		switch (kind)
		{
		case ClickyInkDocument.Kind.Table:
		case ClickyInkDocument.Kind.Receipt:
		case ClickyInkDocument.Kind.Day:
		case ClickyInkDocument.Kind.Chart:
			return true;
		default:
			return false;
		}
	}

	public static bool IsObject(ClickyInkDocument.Kind kind)
	{
		switch (kind)
		{
		case ClickyInkDocument.Kind.Table:
		case ClickyInkDocument.Kind.Figure:
		case ClickyInkDocument.Kind.Sticky:
		case ClickyInkDocument.Kind.Ticket:
		case ClickyInkDocument.Kind.Receipt:
		case ClickyInkDocument.Kind.Photo:
		case ClickyInkDocument.Kind.Place:
		case ClickyInkDocument.Kind.Day:
		case ClickyInkDocument.Kind.Letter:
		case ClickyInkDocument.Kind.Clip:
		case ClickyInkDocument.Kind.File:
		case ClickyInkDocument.Kind.Question:
		case ClickyInkDocument.Kind.Chart:
		case ClickyInkDocument.Kind.Form:
		case ClickyInkDocument.Kind.Connect:
		case ClickyInkDocument.Kind.Items:
		case ClickyInkDocument.Kind.Quiz:
		case ClickyInkDocument.Kind.Todo:
		case ClickyInkDocument.Kind.Gallery:
		case ClickyInkDocument.Kind.Event:
		case ClickyInkDocument.Kind.Criteria:
			return true;
		default:
			return false;
		}
	}

	public static double Pace(ClickyInkDocument.Kind kind)
	{
		switch (kind)
		{
		case ClickyInkDocument.Kind.Heading:
		case ClickyInkDocument.Kind.Answer:
			return 31.200000000000003;
		case ClickyInkDocument.Kind.Code:
		case ClickyInkDocument.Kind.Letter:
			return 115.19999999999999;
		case ClickyInkDocument.Kind.Paragraph:
		case ClickyInkDocument.Kind.Quote:
			return 62.400000000000006;
		default:
			return 48.0;
		}
	}
}
