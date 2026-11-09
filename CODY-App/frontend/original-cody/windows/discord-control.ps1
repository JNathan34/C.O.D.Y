param([Parameter(Mandatory=$true)][string]$Request)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
Add-Type -AssemblyName Accessibility
Add-Type -ReferencedAssemblies Accessibility -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Accessibility;

public sealed class CodyDiscordControl
{
    private static readonly string[] DiscordProcesses = { "Discord", "DiscordPTB", "DiscordCanary" };
    private static readonly string[] ShareButtons = { "Share Your Screen", "Share Screen", "Screen Share", "Start Screen Share", "Start Sharing Your Screen" };
    private static readonly string[] PickerNames = { "Share Your Screen", "Share Screen", "Screen Share", "Go Live", "Screen Share Settings" };
    private static readonly string[] StopButtons = { "Stop Streaming", "Stop Stream", "Stop Sharing", "Stop Screen Sharing", "Stop Sharing Your Screen", "Stop Sharing Screen", "Stop Screenshare" };
    private static readonly string[] ScreenTabs = { "Screens", "Entire Screen", "Displays" };
    private static readonly string[] AppTabs = { "Applications", "Window", "Windows" };
    private static readonly string[] GoLiveButtons = { "Go Live", "Start Streaming", "Start Sharing" };
    private static readonly Dictionary<string, string> AppProcesses = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        { "firefox", "firefox" }, { "mozilla firefox", "firefox" }, { "fire fox", "firefox" },
        { "chrome", "chrome" }, { "google chrome", "chrome" },
        { "microsoft edge", "msedge" }, { "edge", "msedge" }, { "visual studio code", "code" },
        { "vs code", "code" }, { "vscode", "code" }, { "word", "winword" }, { "microsoft word", "winword" },
        { "excel", "excel" }, { "microsoft excel", "excel" }, { "powerpoint", "powerpnt" },
        { "microsoft powerpoint", "powerpnt" }, { "file explorer", "explorer" }, { "paint", "mspaint" }
    };
    private const int InvisibleOrOffscreen = 0x18000;
    private const int Unavailable = 0x1;
    private const int SelectedOrPressed = 0x1A;
    private const uint ChromiumAccessibilityProbe = 1;

    private delegate bool WindowCallback(IntPtr hwnd, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumWindows(WindowCallback callback, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr hwnd, WindowCallback callback, IntPtr data);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr hwnd, int command);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder value, int size);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder value, int size);
    [DllImport("oleacc.dll")] private static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint objectId, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IAccessible node);
    [DllImport("oleacc.dll")] private static extern int AccessibleChildren(IAccessible node, int start, int count, [Out, MarshalAs(UnmanagedType.LPArray, ArraySubType=UnmanagedType.Struct)] object[] children, out int found);

    private sealed class Node
    {
        internal IAccessible Accessible;
        internal int Child;
        internal string Name;
        internal int Role;
        internal int State;
        internal Node Parent;
        internal bool IsAction { get { return Role == 43 || Role == 44 || Role == 45 || Role == 37 || Role == 62; } }
        internal bool Enabled { get { return (State & Unavailable) == 0; } }
        internal bool Selected { get { return (State & SelectedOrPressed) != 0; } }

        internal void CheckCurrent(bool requireEnabled)
        {
            int state = Convert.ToInt32(Accessible.get_accState(Child));
            if ((state & InvisibleOrOffscreen) != 0 || requireEnabled && (state & Unavailable) != 0 ||
                !String.Equals((Accessible.get_accName(Child) ?? "").Trim(), Name, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("That Discord control is no longer available.");
        }

        internal void Invoke()
        {
            CheckCurrent(true);
            Accessible.accDoDefaultAction(Child);
        }
    }

    private sealed class Source
    {
        internal Node Label;
        internal Node Action;
    }

    private sealed class VoiceState
    {
        internal Node Control;
        internal bool Enabled;
    }

    private readonly IntPtr window;
    private readonly uint processId;
    private readonly HashSet<IntPtr> requestedAccessibility = new HashSet<IntPtr>();

    public CodyDiscordControl()
    {
        var windows = new List<IntPtr>();
        foreach (string name in DiscordProcesses)
        {
            foreach (Process process in Process.GetProcessesByName(name))
            {
                using (process)
                {
                    IntPtr handle = process.MainWindowHandle;
                    if (handle != IntPtr.Zero) windows.Add(handle);
                }
            }
        }
        if (windows.Count == 0)
            throw new InvalidOperationException("Open the Discord desktop app and try again.");
        if (windows.Count != 1)
            throw new InvalidOperationException("More than one Discord client is open. Open just the one you want to control.");
        window = windows[0];
        GetWindowThreadProcessId(window, out processId);
        if (IsIconic(window)) ShowWindowAsync(window, 9);
    }

    private static bool IsNamed(Node node, IEnumerable<string> names)
    {
        return names.Contains(node.Name, StringComparer.OrdinalIgnoreCase);
    }

    private List<Node> Read()
    {
        uint current;
        GetWindowThreadProcessId(window, out current);
        if (current == 0 || current != processId)
            throw new InvalidOperationException("The Discord window closed. Open it and try again.");

        var nodes = new List<Node>();
        var handles = new List<IntPtr>();
        EnumChildWindows(window, (hwnd, data) => {
            var name = new StringBuilder(64);
            GetClassName(hwnd, name, name.Capacity);
            if (IsWindowVisible(hwnd) && name.ToString() == "Chrome_RenderWidgetHostHWND")
                handles.Add(hwnd);
            return true;
        }, IntPtr.Zero);
        if (handles.Count == 0) handles.Add(window);
        int budget = 4500;
        foreach (IntPtr handle in handles)
        {
            Guid iid = typeof(IAccessible).GUID;
            IAccessible root;
            // Chromium can leave web accessibility disabled until an MSAA client requests it.
            if (handle != window && requestedAccessibility.Add(handle))
                AccessibleObjectFromWindow(handle, ChromiumAccessibilityProbe, ref iid, out root);
            if (AccessibleObjectFromWindow(handle, unchecked((uint)-4), ref iid, out root) >= 0 && root != null)
                Walk(root, 0, null, nodes, 0, ref budget);
        }
        return nodes;
    }

    private static void Walk(IAccessible accessible, int child, Node parent, List<Node> nodes, int depth, ref int budget)
    {
        if (depth > 28 || budget-- <= 0) return;
        Node node;
        try
        {
            node = new Node {
                Accessible = accessible, Child = child, Parent = parent,
                State = Convert.ToInt32(accessible.get_accState(child)),
                Role = Convert.ToInt32(accessible.get_accRole(child)),
                Name = (accessible.get_accName(child) ?? "").Trim()
            };
        }
        catch (COMException) { return; }
        catch (ArgumentException) { return; }
        catch (FormatException) { return; }
        if ((node.State & InvisibleOrOffscreen) == 0 && (node.Name.Length != 0 || node.Role == 18))
            nodes.Add(node);
        if (child != 0) return;
        int count;
        try { count = Math.Min(accessible.accChildCount, budget); }
        catch (COMException) { return; }
        if (count <= 0) return;
        var children = new object[count];
        int found;
        if (AccessibleChildren(accessible, 0, count, children, out found) < 0) return;
        for (int i = 0; i < found && budget > 0; i++)
        {
            var element = children[i] as IAccessible;
            if (element != null) Walk(element, 0, node, nodes, depth + 1, ref budget);
            else if (children[i] is int) Walk(accessible, (int)children[i], node, nodes, depth + 1, ref budget);
        }
    }

    private static T WaitFor<T>(Func<T> read, int milliseconds) where T : class
    {
        var timer = Stopwatch.StartNew();
        do
        {
            T result = read();
            if (result != null) return result;
            Thread.Sleep(150);
        } while (timer.ElapsedMilliseconds < milliseconds);
        return null;
    }

    private static bool Within(Node node, Node root)
    {
        for (Node current = node; current != null; current = current.Parent)
            if (current == root) return true;
        return false;
    }

    private static Node SingleAction(IEnumerable<Node> nodes, string[] names, bool enabledOnly = true)
    {
        var matches = nodes.Where(node => node.IsAction && (node.Enabled || !enabledOnly) && IsNamed(node, names)).Take(2).ToArray();
        return matches.Length == 1 ? matches[0] : null;
    }

    private static Node CallControl(List<Node> nodes, string[] names, bool enabledOnly = true)
    {
        var userArea = nodes.Where(node => node.Name.Equals("User area", StringComparison.OrdinalIgnoreCase)).Take(2).ToArray();
        if (userArea.Length == 1)
        {
            var control = SingleAction(nodes.Where(node => Within(node, userArea[0])), names, enabledOnly);
            if (control != null) return control;
        }
        return SingleAction(nodes, names, enabledOnly);
    }

    private VoiceState ReadVoice(string[] onNames, string[] offNames)
    {
        Node control = CallControl(Read(), onNames.Concat(offNames).ToArray(), false);
        if (control == null) return null;
        return new VoiceState {
            Control = control,
            Enabled = IsNamed(control, offNames) || control.Selected
        };
    }

    public bool Voice(string feature, string state)
    {
        if ((feature != "mute" && feature != "deafen") || (state != "on" && state != "off" && state != "toggle"))
            throw new ArgumentException("Invalid Discord voice command.");
        string[] on = feature == "mute" ? new[] { "Mute", "Mute Microphone" } : new[] { "Deafen", "Deafen Audio" };
        string[] off = feature == "mute" ? new[] { "Unmute", "Unmute Microphone" } : new[] { "Undeafen", "Undeafen Audio" };
        VoiceState current = ReadVoice(on, off);
        IntPtr previousWindow = GetForegroundWindow();
        if (current != null || previousWindow == window) return ApplyVoice(current, on, off, state);

        // An inactive renderer may defer publishing its accessibility tree until it receives focus.
        SetForegroundWindow(window);
        try
        {
            if (WaitFor(() => ReadVoice(on, off), 3500) == null)
                throw new InvalidOperationException("Open your signed-in Discord window so C.O.D.Y. can find your voice controls.");
            // Let Chromium finish switching the renderer before invoking its first control.
            Thread.Sleep(300);
            return ApplyVoice(ReadVoice(on, off), on, off, state);
        }
        finally
        {
            if (previousWindow != IntPtr.Zero && GetForegroundWindow() == window)
                SetForegroundWindow(previousWindow);
        }
    }

    private bool ApplyVoice(VoiceState current, string[] on, string[] off, string state)
    {
        if (current == null) current = WaitFor(() => ReadVoice(on, off), 3500);
        if (current == null)
            throw new InvalidOperationException("Open your signed-in Discord window so C.O.D.Y. can find your voice controls.");
        bool desired = state == "toggle" ? !current.Enabled : state == "on";
        if (current.Enabled == desired) return desired;
        current.Control.Invoke();
        VoiceState confirmed = WaitFor(() => {
            VoiceState reading = ReadVoice(on, off);
            return reading != null && reading.Enabled == desired ? reading : null;
        }, 3500);
        if (confirmed == null)
            throw new InvalidOperationException("Discord did not confirm the requested voice state.");
        return confirmed.Enabled;
    }

    private static Node Picker(List<Node> nodes)
    {
        var dialogs = nodes.Where(node => node.Role == 18 && (IsNamed(node, PickerNames) ||
            nodes.Any(label => label.Role != 18 && !label.IsAction && Within(label, node) && IsNamed(label, PickerNames))))
            .Take(2).ToArray();
        return dialogs.Length == 1 ? dialogs[0] : null;
    }

    private static Source[] Sources(List<Node> nodes, Node picker, HashSet<string> names)
    {
        var sources = new List<Source>();
        foreach (Node label in nodes.Where(node => names.Contains(node.Name) && Within(node, picker)))
        {
            for (Node node = label; node != picker && node != null; node = node.Parent)
            {
                if (!node.IsAction) continue;
                if (node.Enabled && (node.State & InvisibleOrOffscreen) == 0 && !sources.Any(source => source.Action == node))
                    sources.Add(new Source { Label = label, Action = node });
                break;
            }
        }
        return sources.ToArray();
    }

    private static HashSet<string> WindowNames(string app)
    {
        string executable;
        bool knownApp = AppProcesses.TryGetValue(app, out executable);
        if (!knownApp) executable = app.Replace(" ", "");
        var matches = new List<string>();
        var titleCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        EnumWindows((hwnd, data) => {
            if (!IsWindowVisible(hwnd)) return true;
            var title = new StringBuilder(512);
            if (GetWindowText(hwnd, title, title.Capacity) <= 0) return true;
            string text = title.ToString().Trim();
            int count;
            titleCounts.TryGetValue(text, out count);
            titleCounts[text] = count + 1;
            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            try
            {
                using (var process = Process.GetProcessById((int)pid))
                {
                    if (DiscordProcesses.Contains(process.ProcessName, StringComparer.OrdinalIgnoreCase)) return true;
                    if (process.ProcessName.Equals(executable, StringComparison.OrdinalIgnoreCase) ||
                        !knownApp && text.Equals(app, StringComparison.OrdinalIgnoreCase))
                        matches.Add(text);
                }
            }
            catch (ArgumentException) {}
            catch (InvalidOperationException) {}
            return true;
        }, IntPtr.Zero);
        if (matches.Count > 1 || matches.Any(title => titleCounts[title] != 1))
            throw new InvalidOperationException("More than one window could match " + app + ". Choose the exact window in Discord.");
        return new HashSet<string>(matches, StringComparer.OrdinalIgnoreCase);
    }

    public string Share(int screen, string app)
    {
        if (screen < 0 || screen > 32 || (screen == 0) == String.IsNullOrWhiteSpace(app))
            throw new ArgumentException("Choose a Discord screen number or an open app.");
        var names = screen != 0
            ? new HashSet<string>(new[] { "Screen " + screen, "Display " + screen, "Entire Screen " + screen }, StringComparer.OrdinalIgnoreCase)
            : WindowNames(app.Trim());
        if (names.Count == 0) throw new InvalidOperationException("Open " + app + " before sharing it on Discord.");

        SetForegroundWindow(window);
        List<Node> nodes = Read();
        if (nodes.Any(node => node.IsAction && IsNamed(node, StopButtons)))
            throw new InvalidOperationException("Discord is already sharing a source. Stop that share before starting another.");
        Node picker = Picker(nodes);
        if (picker == null)
        {
            Node open = WaitFor(() => CallControl(Read(), ShareButtons), 3500);
            if (open == null)
                throw new InvalidOperationException("Join a Discord voice channel or call and open its screen-share controls.");
            open.Invoke();
        }
        picker = WaitFor(() => { nodes = Read(); return Picker(nodes); }, 3500);
        if (picker == null)
            throw new InvalidOperationException("C.O.D.Y. could not identify Discord's share picker. Choose the source in Discord.");

        string[] category = screen != 0 ? ScreenTabs : AppTabs;
        Node tab = SingleAction(nodes.Where(node => Within(node, picker)), category);
        if (tab == null)
            throw new InvalidOperationException("C.O.D.Y. could not identify the screen or window tab. Choose the source in Discord.");
        if (!tab.Selected) tab.Invoke();
        Source[] sources = WaitFor(() => {
            nodes = Read();
            Node current = Picker(nodes);
            if (current == null) return null;
            Node activeTab = SingleAction(nodes.Where(node => Within(node, current)), category);
            if (activeTab == null || !activeTab.Selected) return null;
            Source[] matches = Sources(nodes, current, names);
            return matches.Length == 0 ? null : matches;
        }, 2500);
        if (sources == null || sources.Length != 1)
            throw new InvalidOperationException("C.O.D.Y. could not identify one matching share source. Choose the exact screen or window in Discord.");

        string chosen = sources[0].Label.Name;
        sources[0].Label.CheckCurrent(false);
        sources[0].Action.Invoke();
        var exact = new HashSet<string>(new[] { chosen }, StringComparer.OrdinalIgnoreCase);
        bool selectionConfirmed = false;
        Node goLive = WaitFor(() => {
            nodes = Read();
            Node current = Picker(nodes);
            if (current == null) return null;
            var controls = nodes.Where(node => Within(node, current)).ToArray();
            Source[] options = Sources(nodes, current, exact);
            bool selected = options.Length == 1 && (options[0].Action.Selected || options[0].Label.Selected);
            bool preview = options.Length == 0 && controls.Any(node => exact.Contains(node.Name)) &&
                !controls.Any(node => node.IsAction && (IsNamed(node, ScreenTabs) || IsNamed(node, AppTabs)));
            selectionConfirmed = selected || preview;
            return selectionConfirmed ? SingleAction(controls, GoLiveButtons) : null;
        }, 2200);
        if (goLive == null) return selectionConfirmed ? "selected" : "review";
        goLive.Invoke();
        return WaitFor(() => {
            nodes = Read();
            return Picker(nodes) == null ? nodes.FirstOrDefault(node => node.IsAction && IsNamed(node, StopButtons)) : null;
        }, 3800) != null ? "started" : "requested";
    }
}
'@

$command=ConvertFrom-Json -InputObject $Request
$discord=New-Object CodyDiscordControl
if($null -ne $command.feature){
  @{enabled=$discord.Voice([string]$command.feature,[string]$command.state)} | ConvertTo-Json -Compress
}else{
  @{status=$discord.Share([int]$command.screen,[string]$command.app)} | ConvertTo-Json -Compress
}
