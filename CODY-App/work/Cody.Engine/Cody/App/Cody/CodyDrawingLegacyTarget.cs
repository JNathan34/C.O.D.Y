using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;

namespace HeyClicky.App.Cody;

// Firefox and some Chromium builds expose their document through MSAA rather
// than UIA. Hit-test the retained owner's tree, never the desktop overlay.
internal static class CodyDrawingLegacyTarget
{
    internal sealed record Node(Accessible Provider, int Child = 0)
    {
        internal int Role => Convert.ToInt32(Provider.get_accRole(Child));
        internal int State => Convert.ToInt32(Provider.get_accState(Child));
        internal bool Visible => (State & (0x8000 | 0x10000)) == 0;
        internal string Name => Provider.get_accName(Child) ?? "";
        internal string Value { get { try { return Provider.get_accValue(Child) ?? ""; } catch (COMException) { return ""; } } }
        internal RectD? Bounds
        {
            get
            {
                Provider.accLocation(out int x, out int y, out int width, out int height, Child);
                return width > 0 && height > 0 ? new RectD(x, y, width, height) : null;
            }
        }
        internal Node Parent => Child != 0 ? new Node(Provider) : Provider.accParent is Accessible parent ? new Node(parent) : null;
        internal IEnumerable<Node> Children()
        {
            if (Child != 0) yield break;
            int count = Math.Min(Provider.accChildCount, 500);
            for (int id = 1; id <= count; id++)
            {
                Node node;
                try { node = Provider.get_accChild(id) is Accessible child ? new Node(child) : new Node(Provider, id); }
                catch (COMException) { node = new Node(Provider, id); }
                yield return node;
            }
        }
        internal Node Hit(PointD point, Func<bool> valid)
        {
            Node node = this;
            for (int depth = 0; depth < 40; depth++)
            {
                if (!valid()) return null;
                if (node.Child != 0) return node;
                object hit = node.Provider.accHitTest((int)Math.Round(point.X), (int)Math.Round(point.Y));
                Node next = hit is Accessible child ? new Node(child) : hit is int id && id != 0 ? new Node(node.Provider, id) : node;
                if (Same(node, next)) return node;
                node = next;
            }
            return node;
        }
    }

    internal sealed record Document(Node Root, Node Element, Node Tab, string Url);
    internal sealed class Anchor(Node element, RectD original, bool control)
    {
        internal RectD Original => original;
        internal bool Control => control;
        private readonly string content = element.Name + "\n" + element.Value;
        private long nextCheck;
        private bool replaced;
        internal RectD? Read()
        {
            if (replaced || !element.Visible) return null;
            if (Environment.TickCount64 >= nextCheck)
            {
                nextCheck = Environment.TickCount64 + 250;
                replaced = content != element.Name + "\n" + element.Value;
            }
            return replaced ? null : element.Bounds;
        }
    }

    internal static Document Capture(nint window, RectD viewport, bool browser, Func<bool> valid)
    {
        valid = WithinBudget(valid, 900);
        Guid iid = typeof(Accessible).GUID;
        if (AccessibleObjectFromWindow(window, 0xFFFFFFFC, ref iid, out var provider) < 0 || provider == null) return null;
        var root = new Node(provider);
        var document = DocumentAt(root, viewport, valid);
        Node contentRoot = root;
        if (document == null)
        {
            // Chromium can expose MSAA only on its renderer's child HWND;
            // the top-level client is then just an empty native pane.
            EnumChildWindows(window, (child, _) =>
            {
                if (!valid()) return false;
                if (!IsWindowVisible(child)) return true;
                Guid childIid = typeof(Accessible).GUID;
                try
                {
                    if (AccessibleObjectFromWindow(child, 0xFFFFFFFC, ref childIid, out var childProvider) < 0 || childProvider == null) return true;
                    var candidate = new Node(childProvider);
                    if (candidate.Bounds is not { } bounds || !bounds.Contains(new PointD(viewport.X + viewport.Width / 2, viewport.Y + viewport.Height / 2))) return true;
                    if (DocumentAt(candidate, viewport, valid) is { } found) { document = found; contentRoot = candidate; return false; }
                }
                catch (COMException) { }
                return true;
            }, 0);
        }
        if (document == null || !valid()) return null;
        Node tab = null;
        if (browser)
        {
            int budget = 500;
            tab = Find(root, node => node.Role == 37 && (node.State & 2) != 0 && node.Visible, ref budget, valid);
        }
        return new Document(contentRoot, document, tab, document.Value);
    }

    internal static CodyDrawingTarget.Frame Read(Document document, RectD viewport,
        IReadOnlyList<CodyDrawingTarget.Query> queries, Func<bool> valid)
    {
        valid = WithinBudget(valid, 550);
        if (!valid()) return null;
        if (document.Tab != null)
        {
            try { if ((document.Tab.State & 2) == 0) return new CodyDrawingTarget.Frame([]); }
            catch (COMException ex) when (ex.HResult == unchecked((int)0x80040201))
            { return new CodyDrawingTarget.Frame([], TabClosed: true); }
        }
        var current = DocumentAt(document.Root, viewport, valid);
        if (current == null || !Same(current, document.Element) || !document.Element.Visible || document.Element.Value != document.Url)
            return new CodyDrawingTarget.Frame([]);
        var readings = new List<CodyDrawingTarget.Reading>();
        foreach (var query in queries)
        {
            if (!valid()) return null;
            var anchor = query.Anchor;
            try
            {
                if (anchor == null && query.Bind && Bind(document.Element, query.OriginalBox, valid) is { } legacy)
                    anchor = new CodyDrawingTarget.Anchor(null, null, legacy.Original, legacy.Control, legacy);
                readings.Add(new CodyDrawingTarget.Reading(query.Id, anchor, anchor?.Read()));
            }
            catch (COMException) { readings.Add(new CodyDrawingTarget.Reading(query.Id, anchor, null)); }
        }
        return new CodyDrawingTarget.Frame(readings.ToArray());
    }

    private static Anchor Bind(Node document, RectD box, Func<bool> valid)
    {
        Anchor text = null;
        foreach (double fraction in new[] { .5, .1, .04, .74, .93 })
        {
            if (!valid()) return null;
            var leaf = document.Hit(new PointD(box.X + box.Width * fraction, box.Y + box.Height / 2), valid);
            bool belongs = false;
            int depth = 0;
            for (var ancestor = leaf; ancestor != null && depth++ < 64 && valid(); ancestor = ancestor.Parent)
                if (Same(ancestor, document)) { belongs = true; break; }
            if (!belongs) continue;
            int ancestors = 0;
            for (var node = leaf; node != null && !Same(node, document) && ancestors++ < 64 && valid(); node = node.Parent)
            {
                if (!node.Visible || node.Bounds is not { } bounds || !Fits(box, bounds)) continue;
                int role = node.Role;
                if (role == 40) return new Anchor(node, bounds, false); // Graphic, including an icon.
                if (role is 30 or 34 or 35 or 43 or 44 or 45 or 46)
                    return new Anchor(node, bounds, true);
                if (text == null && role == 41 && !string.IsNullOrWhiteSpace(node.Name)) text = new Anchor(node, bounds, false);
            }
        }
        return text;
    }

    private static Node DocumentAt(Node root, RectD viewport, Func<bool> valid)
    {
        var point = new PointD(viewport.X + viewport.Width / 2, viewport.Y + viewport.Height / 2);
        Node document = null;
        int depth = 0;
        for (var node = root.Hit(point, valid); node != null && depth++ < 64 && valid(); node = node.Parent)
        {
            if (node.Role == 15 && node.Visible) document = node;
            if (Same(node, root)) return document;
        }
        return null;
    }
    private static Node Find(Node root, Func<Node, bool> matches, ref int budget, Func<bool> valid, int depth = 0)
    {
        if (budget-- <= 0 || depth > 24 || !valid()) return null;
        try
        {
            if (matches(root)) return root;
            foreach (var child in root.Children())
            {
                var found = Find(child, matches, ref budget, valid, depth + 1);
                if (found != null) return found;
                if (budget <= 0) break;
            }
        }
        catch (COMException) { }
        return null;
    }
    private static bool Fits(RectD mark, RectD target) => target.Width <= mark.Width * 1.5 &&
        target.Height <= mark.Height * 1.5 && mark.Contains(new PointD(target.X + target.Width / 2, target.Y + target.Height / 2));
    private static Func<bool> WithinBudget(Func<bool> valid, int milliseconds)
    {
        long deadline = Environment.TickCount64 + milliseconds;
        return () => Environment.TickCount64 < deadline && valid();
    }
    private static bool Same(Node a, Node b)
    {
        if (a == null || b == null || a.Child != b.Child) return false;
        if (ReferenceEquals(a.Provider, b.Provider)) return true;
        if (!Marshal.IsComObject(a.Provider) || !Marshal.IsComObject(b.Provider)) return false;
        nint first = Marshal.GetIUnknownForObject(a.Provider), second = Marshal.GetIUnknownForObject(b.Provider);
        try { return first == second; }
        finally { Marshal.Release(first); Marshal.Release(second); }
    }

    [DllImport("oleacc.dll")]
    private static extern int AccessibleObjectFromWindow(nint window, uint objectId, ref Guid iid,
        [MarshalAs(UnmanagedType.Interface)] out Accessible accessible);
    private delegate bool EnumChildCallback(nint window, nint data);
    [DllImport("user32.dll")]
    private static extern bool EnumChildWindows(nint parent, EnumChildCallback callback, nint data);
    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(nint window);

    // IAccessible's complete dual-interface prefix, with ordinary BSTR marshaling.
    [ComImport, Guid("618736E0-3C3D-11CF-810C-00AA00389B71"), InterfaceType(ComInterfaceType.InterfaceIsDual)]
    internal interface Accessible
    {
        object accParent { [return: MarshalAs(UnmanagedType.IDispatch)] get; }
        int accChildCount { get; }
        [return: MarshalAs(UnmanagedType.IDispatch)] object get_accChild([MarshalAs(UnmanagedType.Struct)] object child);
        [return: MarshalAs(UnmanagedType.BStr)] string get_accName([MarshalAs(UnmanagedType.Struct)] object child);
        [return: MarshalAs(UnmanagedType.BStr)] string get_accValue([MarshalAs(UnmanagedType.Struct)] object child);
        [return: MarshalAs(UnmanagedType.BStr)] string get_accDescription([MarshalAs(UnmanagedType.Struct)] object child);
        [return: MarshalAs(UnmanagedType.Struct)] object get_accRole([MarshalAs(UnmanagedType.Struct)] object child);
        [return: MarshalAs(UnmanagedType.Struct)] object get_accState([MarshalAs(UnmanagedType.Struct)] object child);
        [return: MarshalAs(UnmanagedType.BStr)] string get_accHelp([MarshalAs(UnmanagedType.Struct)] object child);
        int get_accHelpTopic([MarshalAs(UnmanagedType.BStr)] out string file, [MarshalAs(UnmanagedType.Struct)] object child);
        [return: MarshalAs(UnmanagedType.BStr)] string get_accKeyboardShortcut([MarshalAs(UnmanagedType.Struct)] object child);
        object accFocus { [return: MarshalAs(UnmanagedType.Struct)] get; }
        object accSelection { [return: MarshalAs(UnmanagedType.Struct)] get; }
        [return: MarshalAs(UnmanagedType.BStr)] string get_accDefaultAction([MarshalAs(UnmanagedType.Struct)] object child);
        void accSelect(int flags, [MarshalAs(UnmanagedType.Struct)] object child);
        void accLocation(out int left, out int top, out int width, out int height, [MarshalAs(UnmanagedType.Struct)] object child);
        [return: MarshalAs(UnmanagedType.Struct)] object accNavigate(int direction, [MarshalAs(UnmanagedType.Struct)] object child);
        [return: MarshalAs(UnmanagedType.Struct)] object accHitTest(int x, int y);
        void accDoDefaultAction([MarshalAs(UnmanagedType.Struct)] object child);
        void put_accName([MarshalAs(UnmanagedType.Struct)] object child, [MarshalAs(UnmanagedType.BStr)] string name);
        void put_accValue([MarshalAs(UnmanagedType.Struct)] object child, [MarshalAs(UnmanagedType.BStr)] string value);
    }
}
