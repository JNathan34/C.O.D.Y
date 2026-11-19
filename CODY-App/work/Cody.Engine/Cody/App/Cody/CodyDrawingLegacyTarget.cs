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
        internal byte[] Identity
        {
            get
            {
                if (Provider is not AccIdentity source) return null;
                nint data=0;
                try
                {
                    source.GetIdentityString(unchecked((uint)Child),out data,out uint length);
                    if (data==0 || length is 0 or >4096) return null;
                    var identity=new byte[length];Marshal.Copy(data,identity,0,(int)length);
                    return identity;
                }
                catch (COMException) { return null; }
                finally { if (data!=0) Marshal.FreeCoTaskMem(data); }
            }
        }
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
        private static Node Resolve(Accessible provider, int id)
        {
            try { if (provider.get_accChild(id) is Accessible child) return new Node(child); }
            catch (COMException) { }
            return new Node(provider, id);
        }
        internal IEnumerable<Node> Children()
        {
            if (Child != 0) yield break;
            int count = Math.Clamp(Provider.accChildCount, 0, 500);
            if (Marshal.IsComObject(Provider))
            {
                // Child IDs are provider IDs, not guaranteed to be 1..count
                // (notably in Firefox). Enumerate the actual VARIANT children.
                var children = new object[count];
                if (AccessibleChildren(Provider, 0, count, children, out int obtained) >= 0)
                {
                    foreach (var child in children.Take(obtained))
                        if (child is Accessible accessible) yield return new Node(accessible);
                        else if (child is int id && id != 0) yield return Resolve(Provider, id);
                    yield break;
                }
            }
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
            int remaining = 500;
            for (int depth = 0; depth < 40; depth++)
            {
                if (!valid()) return null;
                if (node.Child != 0) return node;
                object hit = node.Provider.accHitTest((int)Math.Round(point.X), (int)Math.Round(point.Y));
                Node next = hit is Accessible child ? new Node(child) : hit is int id && id != 0 ? Resolve(node.Provider, id) : node;
                if (Same(node, next))
                {
                    // Some browser providers return their document for every
                    // accHitTest. Descend only that retained owner's children.
                    Node containing = null;
                    double smallest = double.MaxValue;
                    foreach (var candidate in node.Children())
                    {
                        if (remaining-- <= 0 || !valid()) return node;
                        if (!candidate.Visible || candidate.Bounds is not { } box || !box.Contains(point)) continue;
                        double area = box.Width * box.Height;
                        if (area < smallest) { containing = candidate; smallest = area; }
                    }
                    if (containing == null) return node;
                    next = containing;
                }
                node = next;
            }
            return node;
        }
        internal Node Focused(Func<bool> valid)
        {
            Node node=this;
            for(int depth=0; depth<40 && valid(); depth++)
            {
                if(node.Child!=0) return node;
                object value=node.Provider.accFocus;
                var next=value is Accessible child ? new Node(child) : value is int id && id!=0 ? Resolve(node.Provider,id) : node;
                if(Same(node,next)) return node;
                node=next;
            }
            return node;
        }
    }

    internal sealed record Document(Node Root, Node Element, Node Tab, string Url, nint Window = 0, bool Firefox = false)
    { internal string Status = "captured"; }
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

    internal static Document Capture(nint window, RectD viewport, bool browser, Func<bool> valid, bool firefox = false)
    {
        using var dpi = new PhysicalCoordinates();
        valid = WithinBudget(valid, 900);
        Guid iid = typeof(Accessible).GUID;
        if (AccessibleObjectFromWindow(window, 0xFFFFFFFC, ref iid, out var provider) < 0 || provider == null) return null;
        var root = new Node(provider);
        var document = firefox
            ? ActiveDocumentAt(window, viewport, valid, IsFirefoxPage) ?? ActiveFirefoxDocument(root, viewport, valid)
            : DocumentAt(root, viewport, valid);
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
                    var found = firefox ? ActiveFirefoxDocument(candidate, viewport, valid) : DocumentAt(candidate, viewport, valid);
                    if (found != null)
                    {
                        document = found;
                        contentRoot = candidate;
                        return false;
                    }
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
        return new Document(contentRoot, document, tab, document.Value, window, firefox);
    }

    internal static CodyDrawingTarget.Frame Read(Document document, RectD viewport,
        IReadOnlyList<CodyDrawingTarget.Query> queries, Func<bool> valid)
    {
        using var dpi = new PhysicalCoordinates();
        valid = WithinBudget(valid, 550);
        if (!valid()) return null;
        if (document.Tab != null)
        {
            try { if ((document.Tab.State & 2) == 0) { document.Status="inactive tab"; return new CodyDrawingTarget.Frame([]); } }
            catch (COMException ex) when (ex.HResult == unchecked((int)0x80040201))
            { return new CodyDrawingTarget.Frame([], TabClosed: true); }
        }
        // A retained renderer HWND can remain alive underneath a different tab
        // or view in the same top-level window. Resolve the currently visible
        // owner child instead of asking that old renderer about itself.
        var current = document.Firefox
            ? ReadActiveFirefoxDocument(document, viewport, valid)
            : document.Window == 0 ? DocumentAt(document.Root, viewport, valid)
                : ActiveDocumentAt(document.Window, viewport, valid);
        if(current==null && document.Window!=0 && !document.Firefox)
        {
            // A restored renderer can retain live providers while its native
            // entry point is unavailable. Require actual focus inside this
            // exact document, with its owner current, before recovering. The
            // caller's validity guard also permits the Island over that owner;
            // inspect the owner's input thread rather than the Island's focus.
            var nativeFocus=new GuiThreadInfo{Size=(uint)Marshal.SizeOf<GuiThreadInfo>()};
            uint ownerThread=GetWindowThreadProcessId(document.Window,out _);
            if(ownerThread!=0 && valid() && GetGUIThreadInfo(ownerThread,ref nativeFocus) && GetAncestor(nativeFocus.Active,3)==document.Window &&
                document.Element.Focused(valid) is { } focused && (focused.State&4)!=0 &&
                Within(focused,document.Element,valid))
                current=document.Element;
        }
        document.Status = !document.Element.Visible ? "document offscreen" :
            document.Element.Value != document.Url ? "document URL changed" :
            current == null ? "no active document" :
            !Within(current, document.Element, valid) ? "different document" : "active";
        // An incomplete provider read does not prove that the page changed.
        if (document.Status == "no active document") return null;
        if (document.Status != "active") return new CodyDrawingTarget.Frame([]);
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
            catch (COMException) { readings.Add(new CodyDrawingTarget.Reading(query.Id, anchor, null, Unavailable: true)); }
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
            {
                if (Same(ancestor, document)) { belongs = true; break; }
            }
            if (!belongs) continue;
            int ancestors = 0;
            for (var node = leaf; node != null && !Same(node, document) && ancestors++ < 64 && valid(); node = node.Parent)
            {
                if (!node.Visible || node.Bounds is not { } bounds) continue;
                int role = node.Role;
                if (role == 40 && CodyDrawingGeometry.FitsImage(box, bounds)) return new Anchor(node, bounds, false);
                if (!Fits(box, bounds)) continue;
                if (role is 30 or 34 or 35 or 43 or 44 or 45 or 46)
                    return new Anchor(node, bounds, true);
                if (text == null && role == 41 && !string.IsNullOrWhiteSpace(node.Name)) text = new Anchor(node, bounds, false);
            }
        }
        return text;
    }

    // Gecko can report a placeholder document or its own chrome before the
    // page's accessible document is available. Only a real content document
    // can establish or invalidate a Firefox drawing anchor.
    private static Node ReadActiveFirefoxDocument(Document document, RectD viewport, Func<bool> valid)
    {
        if (document.Window == 0) return ActiveFirefoxDocument(document.Root, viewport, valid);
        if (ActiveDocumentAt(document.Window, viewport, valid, IsFirefoxPage) is { } current) return current;
        Guid iid = typeof(Accessible).GUID;
        return AccessibleObjectFromWindow(document.Window, 0xFFFFFFFC, ref iid, out var root) >= 0 && root != null
            ? ActiveFirefoxDocument(new Node(root), viewport, valid)
            : null;
    }

    private static Node ActiveFirefoxDocument(Node root, RectD viewport, Func<bool> valid)
    {
        if (DocumentAt(root, viewport, valid, IsFirefoxPage) is { } hit) return hit;
        var point = new PointD(viewport.X + viewport.Width / 2, viewport.Y + viewport.Height / 2);
        int budget = 140;
        return Find(root, node => IsFirefoxPage(node) && node.Bounds is { } bounds && bounds.Contains(point),
            ref budget, valid);
    }

    private static bool IsFirefoxPage(Node node) => node.Role == 15 && node.Visible &&
        Uri.TryCreate(node.Value, UriKind.Absolute, out var location) &&
        location.Scheme is not ("chrome" or "resource");

    private static Node DocumentAt(Node root, RectD viewport, Func<bool> valid, Func<Node, bool> accepts = null)
    {
        var point = new PointD(viewport.X + viewport.Width / 2, viewport.Y + viewport.Height / 2);
        Node document = null;
        int depth = 0;
        for (var node = root.Hit(point, valid); node != null && depth++ < 64 && valid(); node = node.Parent)
        {
            if (accepts != null ? accepts(node) : node.Role == 15 && node.Visible) document = node;
            if (Same(node, root)) return document;
        }
        return null;
    }
    private static Node ActiveDocumentAt(nint window, RectD viewport, Func<bool> valid, Func<Node, bool> accepts = null)
    {
        var screenPoint=new PointD(viewport.X+viewport.Width/2,viewport.Y+viewport.Height/2);
        var chain=VisibleWindowPath(window,screenPoint);
        // The innermost HWND can expose only a generic client proxy. Its
        // renderer parent exposes the document, so walk back up this *active*
        // z-order path rather than enumerating hidden sibling renderers.
        for (int index=chain.Count-1; index>=0 && valid(); index--)
        {
            Guid iid=typeof(Accessible).GUID;
            if (AccessibleObjectFromWindow(chain[index],0xFFFFFFFC,ref iid,out var provider)<0 || provider==null) continue;
            try { if (DocumentAt(new Node(provider),viewport,valid,accepts) is { } active) return active; }
            catch (COMException) { }
        }
        return null;
    }
    private static List<nint> VisibleWindowPath(nint window, PointD screenPoint)
    {
        var chain=new List<nint>{window};
        for (int depth=0; depth<24; depth++)
        {
            var point=new NativePoint{X=(int)Math.Round(screenPoint.X),Y=(int)Math.Round(screenPoint.Y)};
            if (!ScreenToClient(window,ref point)) break;
            // Browser renderer children may use WS_EX_TRANSPARENT to route
            // input through their parent while still presenting the page.
            nint child=ChildWindowFromPointEx(window,point,1); // CWP_SKIPINVISIBLE
            if (child==0 || child==window) break;
            window=child;
            chain.Add(window);
        }
        return chain;
    }
    private static bool Within(Node node, Node ancestor, Func<bool> valid)
    {
        for (int depth=0; node!=null && depth<64 && valid(); depth++,node=node.Parent)
            if (Same(node,ancestor)) return true;
        return false;
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
    // MSAA obeys the calling thread's DPI context, unlike UIA's physical
    // rectangles. Run hit-testing and accLocation in screenshot pixels too.
    private readonly struct PhysicalCoordinates : IDisposable
    {
        private readonly nint previous;
        public PhysicalCoordinates() => previous = OperatingSystem.IsWindows() ? SetThreadDpiAwarenessContext(-4) : 0;
        public void Dispose() { if (previous != 0) SetThreadDpiAwarenessContext(previous); }
    }
    [DllImport("user32.dll")] private static extern nint SetThreadDpiAwarenessContext(nint context);
    [StructLayout(LayoutKind.Sequential)] private struct NativePoint { internal int X,Y; }
    [StructLayout(LayoutKind.Sequential)] private struct GuiThreadInfo
    {
        internal uint Size,Flags;
        internal nint Active,Focus,Capture,MenuOwner,MoveSize,Caret;
        internal int Left,Top,Right,Bottom;
    }
    [DllImport("user32.dll")] private static extern bool GetGUIThreadInfo(uint thread,ref GuiThreadInfo info);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint window,out uint pid);
    [DllImport("user32.dll")] private static extern nint GetAncestor(nint window,uint flags);
    [DllImport("user32.dll")] private static extern bool ScreenToClient(nint window,ref NativePoint point);
    [DllImport("user32.dll")] private static extern nint ChildWindowFromPointEx(nint parent,NativePoint point,uint flags);
    private static bool Same(Node a, Node b)
    {
        if (a == null || b == null) return false;
        if (a.Child == b.Child && ReferenceEquals(a.Provider, b.Provider)) return true;
        // Browser proxies may return different COM wrappers for the same
        // accessible element. Use the provider's opaque identity when present.
        if (a.Identity is { } firstId && b.Identity is { } secondId)
            return firstId.AsSpan().SequenceEqual(secondId);
        if (a.Child != b.Child) return false;
        if (!Marshal.IsComObject(a.Provider) || !Marshal.IsComObject(b.Provider)) return false;
        nint first = Marshal.GetIUnknownForObject(a.Provider), second = Marshal.GetIUnknownForObject(b.Provider);
        try { return first == second; }
        finally { Marshal.Release(first); Marshal.Release(second); }
    }

    [DllImport("oleacc.dll")]
    private static extern int AccessibleChildren([MarshalAs(UnmanagedType.Interface)] Accessible container,
        int start, int count, [Out, MarshalAs(UnmanagedType.LPArray, ArraySubType = UnmanagedType.Struct, SizeParamIndex = 2)] object[] children,
        out int obtained);
    [DllImport("oleacc.dll")]
    private static extern int AccessibleObjectFromWindow(nint window, uint objectId, ref Guid iid,
        [MarshalAs(UnmanagedType.Interface)] out Accessible accessible);
    [ComImport, Guid("7852B78D-1CFD-41C1-A615-9C0C85960B5F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface AccIdentity { void GetIdentityString(uint child,out nint data,out uint length); }
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
