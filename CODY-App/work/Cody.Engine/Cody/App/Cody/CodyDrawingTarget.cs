using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using static HeyClicky.App.Cody.CodyAccessibilityInput;
using static HeyClicky.App.Cody.CodyDrawingGeometry;

namespace HeyClicky.App.Cody;

// Retain the provider objects, including the text endpoints. Accessible names
// and URL strings are never used to find another occurrence after a scroll.
internal static class CodyDrawingTarget
{
    private const int ControlType = 30003, Offscreen = 30022, Rectangle = 30001, Selected = 30079, Name = 30005;
    private const int DocumentType = 50030, TabItemType = 50019, Descendants = 4;
    private const int TextPattern = 10014, ScrollPattern = 10004;
    private const int ElementNotAvailable = unchecked((int)0x80040201);

    internal sealed record Document(UiaElement Element, UiaElement Tab, (double X, double Y)? Scroll,
        CodyDrawingLegacyTarget.Document Legacy = null)
    {
        internal long NextTabCheck;
    }
    internal sealed class Anchor(UiaElement element, UiaRange range, RectD original, bool control = false,
        CodyDrawingLegacyTarget.Anchor legacy = null)
    {
        internal RectD Original { get; } = original;
        internal bool Control { get; } = control;
        private readonly string originalContent = legacy == null ? Content(element, range) : null;
        private long nextCheck;
        private bool replaced;

        internal RectD? Read()
        {
            if (legacy != null) return legacy.Read();
            if (replaced || !Visible(element)) return null;
            long now = Environment.TickCount64;
            if (now >= nextCheck)
            {
                nextCheck = now + 250;
                // A quiz can recycle the same UI object for a different answer.
                // Check only the retained object, without looking for its text elsewhere.
                if (originalContent != Content(element, range)) replaced = true;
            }
            return replaced ? null : range == null ? Bounds(element) : TextBounds(range);
        }
    }
    internal sealed record Query(int Id, RectD OriginalBox, Anchor Anchor, bool Bind);
    internal sealed record Reading(int Id, Anchor Anchor, RectD? Bounds, bool Unavailable = false);
    internal sealed record Frame(Reading[] Targets, bool TabClosed = false);

    internal static async Task<Document> Capture(nint window, RectD viewport, bool browser, Func<bool> valid,
        bool preferLegacy = false, bool firefox = false)
    {
        var response = await Run((uia, _) =>
        {
            var preferred = preferLegacy ? CodyDrawingLegacyTarget.Capture(window, viewport, browser, valid, firefox) : null;
            try
            {
                var root = uia.ElementFromHandle(window);
                var document = DocumentAt(uia, root, Center(viewport)) ?? FindDocument(uia, root, viewport);
                if (document == null)
                {
                    var legacy = preferLegacy ? preferred : CodyDrawingLegacyTarget.Capture(window, viewport, browser, valid, firefox);
                    return new Result(Data: legacy == null ? null : new Document(null, null, null, legacy));
                }
                var tab = browser ? SelectedTab(uia, root, document, viewport) : null;
                return new Result(Data: new Document(document, tab, ReadScroll(document), preferred));
            }
            catch (COMException) when (preferred != null)
            { return new Result(Data: new Document(null, null, null, preferred)); }
        }, valid, TimeSpan.FromMilliseconds(1200)).ConfigureAwait(false);
        return response.Data as Document;
    }

    internal static async Task<Frame> Read(nint window, Document document, RectD viewport,
        IReadOnlyList<Query> queries, Func<bool> valid)
    {
        var response = await Run((uia, _) =>
        {
            if (document.Legacy != null)
            {
                var legacy = CodyDrawingLegacyTarget.Read(document.Legacy, viewport, queries, valid);
                // Keep the MSAA document/tab identity guard. Only supplement a
                // missing target when UIA confirms the same captured page too.
                if (legacy?.Targets.Any(target => target.Anchor == null) == true && document.Element != null &&
                    Active(uia, window, document, viewport) == true)
                {
                    var supplemented = legacy.Targets.Select(target =>
                    {
                        var query = queries.First(item => item.Id == target.Id);
                        if (target.Anchor != null || !query.Bind || !valid()) return target;
                        try
                        {
                            var anchor = Bind(uia, document, query.OriginalBox);
                            return new Reading(target.Id, anchor, anchor?.Read());
                        }
                        catch (COMException) { return target; }
                    }).ToArray();
                    legacy = legacy with { Targets = supplemented };
                }
                return new Result(Data: legacy);
            }
            if (document.Tab != null)
            {
                try
                {
                    if (document.Tab.GetCurrentPropertyValue(Selected) is not true)
                    {
                        long now = Environment.TickCount64;
                        if (now < document.NextTabCheck) return new Result(Data: new Frame([]));
                        document.NextTabCheck = now + 1000;
                        var root = uia.ElementFromHandle(window);
                        var tabs = root.FindAll(Descendants, uia.CreatePropertyCondition(ControlType, TabItemType));
                        bool anotherSelected = false;
                        for (int i = 0; i < tabs.Length && valid(); i++)
                        {
                            var tab = tabs.GetElement(i);
                            if (uia.CompareElements(tab, document.Tab)) return new Result(Data: new Frame([]));
                            if (!anotherSelected && tab.GetCurrentPropertyValue(Selected) is true)
                                anotherSelected = !Within(uia, tab, document.Element);
                        }
                        return new Result(Data: new Frame([], TabClosed: anotherSelected && valid()));
                    }
                }
                catch (COMException ex) when (ex.HResult == ElementNotAvailable)
                {
                    return new Result(Data: new Frame([], TabClosed: true));
                }
            }
            bool? active = Active(uia, window, document, viewport);
            if (active == null) return new Result();
            if (active == false) return new Result(Data: new Frame([]));
            bool canBind = queries.Any(query => query.Bind) && document.Scroll == ReadScroll(document.Element);
            var output = new List<Reading>(queries.Count);
            foreach (var query in queries)
            {
                if (!valid()) break;
                try
                {
                    var anchor = query.Anchor ?? (query.Bind && canBind ? Bind(uia, document, query.OriginalBox) : null);
                    output.Add(new Reading(query.Id, anchor, anchor?.Read()));
                }
                catch (COMException) { output.Add(new Reading(query.Id, query.Anchor, null, Unavailable: true)); }
            }
            return new Result(Data: new Frame(output.ToArray()));
        }, valid, TimeSpan.FromMilliseconds(700)).ConfigureAwait(false);
        // A timeout is different from a positive offscreen or tab-change report.
        return response.Data as Frame;
    }

    private static bool? Active(Uia uia, nint window, Document document, RectD viewport)
    {
        if (!Visible(document.Element) || Bounds(document.Element) is not { } rect ||
            Intersection(rect, viewport) is not { } visible) return false;
        var root = uia.ElementFromHandle(window);
        var active = DocumentAt(uia, root, Center(visible));
        return active == null ? null : Within(uia, active, document.Element);
    }

    private static Anchor Bind(Uia uia, Document document, RectD box)
    {
        // Prefer interactive elements when their accessible bounds fit the mark.
        // Try nearby points for labels whose radio control sits at the left edge.
        Anchor text = null;
        Anchor region = null;
        var walker = uia.RawViewWalker;
        foreach (double fraction in new[] { .5, .1, .04, .26, .74, .93 })
        {
            var point = new Point((int)Math.Round(box.X + box.Width * fraction),
                (int)Math.Round(box.Y + box.Height / 2));
            var leaf = ElementAt(uia, document.Element, point);
            if (!Within(uia, leaf, document.Element)) continue;
            for (var node = leaf; node != null; node = walker.GetParentElement(node))
            {
                if (uia.CompareElements(node, document.Element)) break;
                int role = Role(node);
                // Images have no TextPattern. Falling through to the document's
                // nearest word can attach an icon's ring to a neighbouring heading.
                if (role == 50006 && Bounds(node) is { } image && FitsImage(box, image))
                    return new Anchor(node, null, image);
                if (role is 50000 or 50002 or 50003 or 50005 or 50007 or 50009 or 50011 or 50013 or 50024 &&
                    Bounds(node) is { } bounds && Fits(box, bounds))
                    return new Anchor(node, null, bounds, control: true);
                if (region == null && role is 50016 or 50020 or 50025 or 50026 &&
                    Bounds(node) is { } textArea && textArea.Width >= box.Width * .55 && Fits(box, textArea) &&
                    !string.IsNullOrWhiteSpace(Content(node, null)))
                    region = new Anchor(node, null, textArea);
            }

            if (text == null)
                for (var provider = leaf; provider != null; provider = walker.GetParentElement(provider))
                {
                    if (provider.GetCurrentPattern(TextPattern) is UiaText pattern)
                    {
                        if (box.Width > box.Height * 4)
                        {
                            var line = pattern.RangeFromPoint(point);
                            line?.ExpandToEnclosingUnit(3); // TextUnit_Line
                            if (line != null && TextBounds(line) is { } lineBox && Fits(box, lineBox) &&
                                lineBox.Width >= box.Width * .5)
                            {
                                text = new Anchor(provider, line, lineBox);
                                break;
                            }
                        }
                        var range = pattern.RangeFromPoint(point);
                        range?.ExpandToEnclosingUnit(2); // TextUnit_Word
                        if (range != null && TextBounds(range) is { } bounds && Fits(box, bounds))
                        {
                            text = new Anchor(provider, range, bounds);
                            break;
                        }
                    }
                    if (uia.CompareElements(provider, document.Element)) break;
                }
            if (text == null && leaf != null && Role(leaf) is 50016 or 50020 &&
                Bounds(leaf) is { } leafBox && Fits(box, leafBox))
                text = new Anchor(leaf, null, leafBox);
        }
        if (box.Width > box.Height * 2)
        {
            var radios = document.Element.FindAll(Descendants, uia.CreatePropertyCondition(ControlType, 50013));
            Anchor radio = null;
            for (int i = 0; i < Math.Min(radios.Length, 64); i++)
            {
                var candidate = radios.GetElement(i);
                if (!Visible(candidate) || Bounds(candidate) is not { } bounds || !Fits(box, bounds)) continue;
                if (radio != null) return region ?? text;
                radio = new Anchor(candidate, null, bounds, control: true);
            }
            if (radio != null) return radio;
        }
        return region ?? text;
    }

    private static string Content(UiaElement element, UiaRange range) =>
        range == null ? element.GetCurrentPropertyValue(Name) as string : range.GetText(128);

    private static RectD? TextBounds(UiaRange range)
    {
        var data = range.GetBoundingRectangles();
        if (data?.Length is not (>= 4) || data.Length % 4 != 0) return null;
        RectD? result = null;
        for (int i = 0; i < data.Length; i += 4)
        {
            var rect = new RectD(data[i], data[i + 1], data[i + 2], data[i + 3]);
            if (!Valid(rect)) continue;
            if (result is not { } old) result = rect;
            else
            {
                double x = Math.Min(old.X, rect.X), y = Math.Min(old.Y, rect.Y);
                result = new RectD(x, y, Math.Max(old.Right, rect.Right) - x, Math.Max(old.Bottom, rect.Bottom) - y);
            }
        }
        return result;
    }

    private static UiaElement DocumentAt(Uia uia, UiaElement root, Point point)
    {
        var documents = root.FindAll(Descendants, uia.CreatePropertyCondition(ControlType, DocumentType));
        for (int i = 0; i < Math.Min(documents.Length, 64); i++)
        {
            var document = documents.GetElement(i);
            if (Visible(document) && Bounds(document) is { } bounds &&
                bounds.Contains(new PointD(point.X, point.Y))) return document;
        }
        return null;
    }

    private static UiaElement ElementAt(Uia uia, UiaElement root, Point point)
    {
        // Hit-test inside the owner's accessibility tree. A transparent drawing
        // window can win desktop ElementFromPoint, causing a hide/show feedback loop.
        var hit = uia.ElementFromPoint(point);
        if (Within(uia, hit, root)) return hit;
        var walker = uia.RawViewWalker;
        int remaining = 700, bestDepth = -1;
        UiaElement best = null;
        void Visit(UiaElement node, int depth)
        {
            if (node == null || depth > 48 || remaining-- <= 0 || !Visible(node)) return;
            var rect = Bounds(node);
            if (rect is { } bounds && !bounds.Contains(new PointD(point.X, point.Y))) return;
            if (rect != null && depth > bestDepth) { best = node; bestDepth = depth; }
            for (var child = walker.GetFirstChildElement(node); child != null && remaining > 0;
                child = walker.GetNextSiblingElement(child)) Visit(child, depth + 1);
        }
        Visit(root, 0);
        return best;
    }

    private static UiaElement FindDocument(Uia uia, UiaElement root, RectD viewport)
    {
        var documents = root.FindAll(Descendants, uia.CreatePropertyCondition(ControlType, DocumentType));
        var center = Center(viewport);
        for (int i = 0; i < Math.Min(documents.Length, 32); i++)
        {
            var candidate = documents.GetElement(i);
            if (Visible(candidate) && Bounds(candidate) is { } rect && rect.Contains(new PointD(center.X, center.Y)))
                return candidate;
        }
        return null;
    }

    private static UiaElement SelectedTab(Uia uia, UiaElement root, UiaElement document, RectD viewport)
    {
        var tabs = root.FindAll(Descendants, uia.CreatePropertyCondition(ControlType, TabItemType));
        for (int i = 0; i < Math.Min(tabs.Length, 160); i++)
        {
            var candidate = tabs.GetElement(i);
            if (candidate.GetCurrentPropertyValue(Selected) is true && Bounds(candidate) is { } bounds &&
                Intersection(bounds, viewport) != null && !Within(uia, candidate, document))
                return candidate;
        }
        return null;
    }

    private static bool Within(Uia uia, UiaElement element, UiaElement ancestor)
    {
        if (ancestor == null) return false;
        var walker = uia.RawViewWalker;
        for (int depth = 0; element != null && depth < 64; depth++, element = walker.GetParentElement(element))
            if (uia.CompareElements(element, ancestor)) return true;
        return false;
    }

    private static (double X, double Y)? ReadScroll(UiaElement element)
    {
        try
        {
            return element.GetCurrentPattern(ScrollPattern) is UiaScroll scroll
                ? (scroll.HorizontalPercent, scroll.VerticalPercent) : null;
        }
        catch (COMException) { return null; }
    }

    private static Point Center(RectD rect) => new((int)Math.Round(rect.X + rect.Width / 2), (int)Math.Round(rect.Y + rect.Height / 2));
    private static bool Fits(RectD mark, RectD target)
        => target.Width <= mark.Width * 1.5 && target.Height <= mark.Height * 1.5 &&
            mark.Contains(new PointD(target.X + target.Width / 2, target.Y + target.Height / 2));

    private static bool Valid(RectD rect) => double.IsFinite(rect.X) && double.IsFinite(rect.Y) &&
        double.IsFinite(rect.Width) && double.IsFinite(rect.Height) && rect.Width > 0 && rect.Height > 0;

    private static bool Visible(UiaElement element) => element.GetCurrentPropertyValue(Offscreen) is false;
    private static int Role(UiaElement element) => element.GetCurrentPropertyValue(ControlType) is int type ? type : 0;
    private static RectD? Bounds(UiaElement element)
    {
        if (element.GetCurrentPropertyValue(Rectangle) is not double[] { Length: 4 } r) return null;
        var rect = new RectD(r[0], r[1], r[2], r[3]);
        return Valid(rect) ? rect : null;
    }

    [ComImport, Guid("88F4D42A-E881-459D-A77C-73BBBB7E02DC"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface UiaScroll
    {
        void Scroll(int horizontal, int vertical);
        void SetScrollPercent(double horizontal, double vertical);
        double HorizontalPercent { get; }
        double VerticalPercent { get; }
    }
}
