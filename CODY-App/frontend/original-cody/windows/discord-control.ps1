param([Parameter(Mandatory=$true)][string]$Request)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
Add-Type -AssemblyName Accessibility,UIAutomationClient,UIAutomationTypes
Add-Type -ReferencedAssemblies Accessibility,System.Windows.Forms,UIAutomationClient,UIAutomationTypes -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Forms;
using Accessibility;

public sealed class CodyDiscordControl
{
    private static readonly string[] DiscordProcesses = { "Discord", "DiscordPTB", "DiscordCanary" };
    private static readonly string[] ShareButtons = { "Share Your Screen", "Share Screen", "Screen Share", "Start Screen Share", "Start Sharing Your Screen" };
    private static readonly string[] OwnVoicePanels = { "User status and settings", "User area" };
    private static readonly string[] LeaveCallButtons = { "Disconnect from Voice", "Disconnect from Voice Channel", "Leave Call", "End Call", "Hang Up" };
    private static readonly string[] VoiceStatus = { "Voice Connected", "Video Connected", "RTC Connecting", "Awaiting Endpoint" };
    private static readonly string[] PickerNames = { "Share Your Screen", "Share Screen", "Screen Share", "Go Live", "Screen Share Settings" };
    private static readonly string[] StopButtons = { "Stop Streaming", "Stop Stream", "Stop Sharing", "Stop Screen Sharing", "Stop Sharing Your Screen", "Stop Sharing Screen", "Stop Screenshare" };
    private static readonly string[] StreamOptions = { "Stream Options", "More Stream Options", "Stream Settings" };
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
    private const int Invisible = 0x8000;
    private const int InvisibleOrOffscreen = Invisible | 0x10000;
    private const int Unavailable = 0x1;
    private const int Checked = 0x10;
    private const int SelectedOrPressed = 0x1A;
    private const int MenuItemRole = 12;
    private const int DocumentRole = 15;
    private const int DialogRole = 18;
    private const int LinkRole = 30;
    private const int PageTabRole = 37;
    private const int PageTabListRole = 60;
    private const uint ChromiumAccessibilityProbe = 1;
    private const uint KeepBoundsAndDoNotActivate = 0x213; // SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOOWNERZORDER
    private const int ExtendedWindowStyle = -20;
    private const int Topmost = 0x8;
    private const int ShowWithoutActivation = 4;
    private const int MinimizeWithoutActivation = 7;

    private delegate bool WindowCallback(IntPtr hwnd, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumWindows(WindowCallback callback, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr hwnd, WindowCallback callback, IntPtr data);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", EntryPoint="GetWindowLongW")] private static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr hwnd, int command);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
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
        internal bool IsAction { get { return Role == 43 || Role == 44 || Role == 45 || Role == 37 || Role == 56 || Role == 57 || Role == 62 || Role == MenuItemRole; } }
        internal bool Enabled { get { return (State & Unavailable) == 0; } }
        internal bool Selected { get { return (State & SelectedOrPressed) != 0; } }

        internal void CheckCurrent(bool requireEnabled, bool requireSameSelection = false)
        {
            int state = Convert.ToInt32(Accessible.get_accState(Child));
            if ((state & InvisibleOrOffscreen) != 0 || requireEnabled && (state & Unavailable) != 0 ||
                requireSameSelection && ((state ^ State) & SelectedOrPressed) != 0 ||
                !String.Equals((Accessible.get_accName(Child) ?? "").Trim(), Name, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("That Discord control is no longer available.");
        }

        internal void Invoke(bool requireSameSelection = false)
        {
            CheckCurrent(true, requireSameSelection);
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

    private sealed class CallView
    {
        internal List<Node> Nodes;
        internal Node Panel;
        internal Node Link;
        internal string Channel;
        internal Node Document;
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
    }

    private static bool IsNamed(Node node, IEnumerable<string> names)
    {
        return names.Contains(node.Name, StringComparer.OrdinalIgnoreCase);
    }

    private T WithBackgroundWindow<T>(Func<T> action)
    {
        if (!IsIconic(window)) return action();

        // Chromium may defer accessibility actions while minimized. Restore behind the active window.
        IntPtr foreground = GetForegroundWindow();
        IntPtr behind = foreground != IntPtr.Zero && foreground != window && (GetWindowLong(foreground, ExtendedWindowStyle) & Topmost) == 0
            ? foreground : new IntPtr(1); // HWND_BOTTOM
        if (!SetWindowPos(window, behind, 0, 0, 0, 0, KeepBoundsAndDoNotActivate) ||
            !ShowWindowAsync(window, ShowWithoutActivation))
            throw new InvalidOperationException("Windows could not make the minimized Discord controls available.");
        try
        {
            if (!SpinWait.SpinUntil(() => !IsIconic(window), 2500))
                throw new InvalidOperationException("Windows could not make the minimized Discord controls available.");
            // The restored window can report its previous accessibility tree until Chromium catches up.
            Thread.Sleep(250);
            return action();
        }
        finally
        {
            // Leave the window alone if the user opened Discord during the command.
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner == processId && GetForegroundWindow() != window)
                ShowWindowAsync(window, MinimizeWithoutActivation);
        }
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
        if ((node.State & Invisible) != 0) return;
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
            // Windows PowerShell runs this accessibility client on an STA thread.
            Application.DoEvents();
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

    private static string ChannelOf(Node node)
    {
        Uri address;
        string value;
        try { value = node.Accessible.get_accValue(node.Child); }
        catch (COMException) { return null; }
        if (!Uri.TryCreate(value, UriKind.Absolute, out address) || address.Scheme != Uri.UriSchemeHttps ||
            (address.Host != "discord.com" && address.Host != "ptb.discord.com" && address.Host != "canary.discord.com"))
            return null;
        string[] parts = address.AbsolutePath.TrimEnd('/').Split('/');
        if (parts.Length != 4 || parts[1] != "channels" || parts[2].Length == 0 || parts[3].Length == 0 ||
            (parts[2] != "@me" && !parts[2].All(Char.IsDigit)) || !parts[3].All(Char.IsDigit))
            return null;
        return parts[2] + "/" + parts[3];
    }

    private static CallView ReadCallView(List<Node> nodes)
    {
        var panels = nodes.Where(node => IsNamed(node, OwnVoicePanels)).Take(2).ToArray();
        if (panels.Length != 1) return null;
        Node panel = panels[0];
        var links = nodes.Where(node => node.Role == LinkRole && Within(node, panel) &&
            VoiceStatus.Any(status => node.Name.Equals(status, StringComparison.OrdinalIgnoreCase) ||
                node.Name.StartsWith(status + " ", StringComparison.OrdinalIgnoreCase))).Take(2).ToArray();
        Node link = links.Length == 1 ? links[0] : null;
        string channel = link == null ? null : ChannelOf(link);
        Node document = panel.Parent;
        while (document != null && document.Role != DocumentRole) document = document.Parent;
        return new CallView { Nodes = nodes, Panel = panel, Link = link, Channel = channel,
            Document = document != null && channel != null && ChannelOf(document) == channel ? document : null };
    }

    private CallView OpenConnectedCall()
    {
        CallView call = WaitFor(() => ReadCallView(Read()), 3500);
        if (call == null)
            throw new InvalidOperationException("Open your signed-in Discord window so C.O.D.Y. can find your call controls.");
        if (call.Channel == null)
        {
            if (DisconnectControls(call.Nodes).Length == 0) return null;
            throw new InvalidOperationException("C.O.D.Y. could not identify your connected Discord call.");
        }
        if (call.Document != null) return call;
        if (Picker(call.Nodes) != null)
            throw new InvalidOperationException("Close the open Discord share picker and try again.");

        // This link belongs to the persistent voice panel, even when the main view is a different channel.
        if (ChannelOf(call.Link) != call.Channel)
            throw new InvalidOperationException("Your connected Discord call changed. Try again.");
        call.Link.Invoke();
        CallView connected = WaitFor(() => ConnectedView(call.Channel), 4500);
        if (connected == null)
            throw new InvalidOperationException("Discord did not open your connected call.");
        return connected;
    }

    private CallView ConnectedView(string channel)
    {
        CallView view = ReadCallView(Read());
        return view != null && view.Channel == channel && view.Document != null ? view : null;
    }

    private static Node CallControl(CallView call, string[] names)
    {
        return SingleAction(call.Nodes.Where(node => Within(node, call.Document) && !Within(node, call.Panel)), names) ??
            SingleAction(call.Nodes.Where(node => Within(node, call.Panel)), names);
    }

    private static bool ShowsStream(CallView call)
    {
        return call.Nodes.Any(node => node.IsAction && Within(node, call.Document) &&
            (IsNamed(node, StopButtons) || IsNamed(node, StreamOptions)));
    }

    private static readonly string[] Mute = { "Mute", "Mute Microphone" };
    private static readonly string[] Unmute = { "Unmute", "Unmute Microphone" };
    private static readonly string[] Deafen = { "Deafen", "Deafen Audio" };
    private static readonly string[] Undeafen = { "Undeafen", "Undeafen Audio" };

    private static Node[] DisconnectControls(List<Node> nodes)
    {
        var panels = nodes.Where(node => IsNamed(node, OwnVoicePanels)).ToArray();
        // The channel view can have a second Disconnect button. Use the persistent self controls first.
        var own = nodes.Where(node => node.IsAction &&
            (node.Name.Equals("Disconnect", StringComparison.OrdinalIgnoreCase) || IsNamed(node, LeaveCallButtons)) &&
            panels.Any(panel => Within(node, panel))).Take(2).ToArray();
        return own.Length > 0 ? own : nodes.Where(node => node.IsAction && IsNamed(node, LeaveCallButtons)).Take(2).ToArray();
    }

    private static bool ShowsActiveCall(List<Node> nodes)
    {
        var panels = nodes.Where(node => IsNamed(node, OwnVoicePanels)).ToArray();
        return nodes.Any(node => node.IsAction && IsNamed(node, ShareButtons) ||
            IsNamed(node, VoiceStatus) && panels.Any(panel => Within(node, panel)));
    }

    public string Leave()
    {
        return WithBackgroundWindow(() => {
            var nodes = WaitFor(() => {
                var snapshot = Read();
                return snapshot.Any(node => IsNamed(node, OwnVoicePanels)) || DisconnectControls(snapshot).Length > 0 ? snapshot : null;
            }, 3500);
            if (nodes == null)
                throw new InvalidOperationException("Open your signed-in Discord window so C.O.D.Y. can find your call controls.");
            var controls = DisconnectControls(nodes);
            if (controls.Length == 0 && !ShowsActiveCall(nodes)) return "not-connected";
            if (controls.Length != 1 || !controls[0].Enabled)
                throw new InvalidOperationException("C.O.D.Y. could not identify your Discord disconnect button.");
            controls[0].Invoke();
            var disconnected = WaitFor(() => {
                var snapshot = Read();
                return snapshot.Any(node => IsNamed(node, OwnVoicePanels)) && !ShowsActiveCall(snapshot) &&
                    DisconnectControls(snapshot).Length == 0 ? snapshot : null;
            }, 4500);
            if (disconnected == null)
                throw new InvalidOperationException("Discord did not confirm that you left the call.");
            return "left";
        });
    }

    private VoiceState ReadVoice(string feature)
    {
        List<Node> nodes = Read();
        string[] names = feature == "mute" ? Mute.Concat(Unmute).ToArray() : Deafen.Concat(Undeafen).ToArray();
        string[] companionNames = feature == "mute" ? Deafen.Concat(Undeafen).ToArray() : Mute.Concat(Unmute).ToArray();
        var userAreas = nodes.Where(node => node.Name.Equals("User area", StringComparison.OrdinalIgnoreCase)).Take(2).ToArray();
        Node control = null;
        if (userAreas.Length == 1)
            control = SingleAction(nodes.Where(node => Within(node, userAreas[0])), names, false);
        if (control == null)
        {
            // Discord can expose the self controls in an unnamed pane. Require both controls in that pane.
            var companions = nodes.Where(node => node.IsAction && IsNamed(node, companionNames)).ToArray();
            var paired = nodes.Where(node => node.IsAction && IsNamed(node, names) && companions.Any(other =>
                node.Parent != null && other.Parent != null && (node.Parent == other.Parent ||
                node.Parent.Parent != null && node.Parent.Parent == other.Parent.Parent))).Take(2).ToArray();
            if (paired.Length == 1) control = paired[0];
        }
        if (control == null) return null;
        return new VoiceState { Control = control, Enabled = IsNamed(control, feature == "mute" ? Unmute : Undeafen) || VoiceSelected(control.Role, control.State) };
    }

    private static bool VoiceSelected(int role, int state)
    {
        return (state & (role == 44 ? Checked : SelectedOrPressed)) != 0;
    }

    private static bool? ReadVoiceState(Node control, string feature)
    {
        try
        {
            int state = Convert.ToInt32(control.Accessible.get_accState(control.Child));
            if ((state & InvisibleOrOffscreen) != 0) return null;
            string name = (control.Accessible.get_accName(control.Child) ?? "").Trim();
            string[] offNames = feature == "mute" ? Unmute : Undeafen;
            if (offNames.Contains(name, StringComparer.OrdinalIgnoreCase)) return true;
            string[] onNames = feature == "mute" ? Mute : Deafen;
            if (onNames.Contains(name, StringComparer.OrdinalIgnoreCase)) return VoiceSelected(control.Role, state);
        }
        catch (COMException) {}
        catch (ArgumentException) {}
        return null;
    }

    public sealed class VoiceResult
    {
        public bool Enabled { get; set; }
        public bool Changed { get; set; }
    }

    public VoiceResult Voice(string feature, string state)
    {
        if ((feature != "mute" && feature != "deafen") || (state != "on" && state != "off" && state != "toggle"))
            throw new ArgumentException("Invalid Discord voice command.");
        return WithBackgroundWindow(() => SetVoice(feature, state));
    }

    private VoiceResult SetVoice(string feature, string state)
    {
        VoiceState current = WaitFor(() => ReadVoice(feature), 5000);
        if (current == null)
            throw new InvalidOperationException("Open your signed-in Discord window so C.O.D.Y. can find your voice controls.");
        bool desired = state == "toggle" ? !current.Enabled : state == "on";
        if (current.Enabled == desired)
        {
            current.Control.CheckCurrent(false, true);
            return new VoiceResult { Enabled = desired };
        }
        if (!current.Control.Enabled)
            throw new InvalidOperationException("Discord's " + feature + " control is disabled. Check your voice state in Discord.");
        current.Control.Invoke(true);
        // Re-read the invoked control first. Scanning the full Chromium tree can take several seconds.
        if (WaitFor(() => ReadVoiceState(current.Control, feature) == desired ? current : null, 1500) != null)
            return new VoiceResult { Enabled = desired, Changed = true };
        VoiceState confirmed = WaitFor(() => {
            VoiceState reading = ReadVoice(feature);
            return reading != null && reading.Enabled == desired ? reading : null;
        }, 5000);
        if (confirmed == null)
            throw new InvalidOperationException("Discord did not confirm the requested voice state.");
        return new VoiceResult { Enabled = confirmed.Enabled, Changed = true };
    }

    private static Node Picker(List<Node> nodes)
    {
        var dialogs = nodes.Where(node => node.Role == DialogRole && (IsNamed(node, PickerNames) ||
            nodes.Any(label => label.Role != DialogRole && !label.IsAction && Within(label, node) && IsNamed(label, PickerNames)) ||
            HasShareTabs(nodes, node))).ToArray();
        // A parent dialog can contain the same heading as its nested source picker.
        var innermost = dialogs.Where(dialog => !dialogs.Any(other => other != dialog && Within(other, dialog))).Take(2).ToArray();
        return innermost.Length == 1 ? innermost[0] : null;
    }

    private static bool HasShareTabs(List<Node> nodes, Node dialog)
    {
        // Current Discord exposes an unnamed modal with both categories in one tab list.
        return nodes.Any(tab => tab.Role == PageTabRole && IsNamed(tab, ScreenTabs) &&
            tab.Parent != null && tab.Parent.Role == PageTabListRole && Within(tab.Parent, dialog) &&
            nodes.Any(other => other.Parent == tab.Parent && other.Role == PageTabRole && IsNamed(other, AppTabs)));
    }

    private void SelectShareTab(Node tab)
    {
        if (tab.Role == PageTabRole)
        {
            tab.CheckCurrent(true, true);
            // Chromium exposes these as MSAA tabs but their default action can do nothing.
            // UI Automation exposes the actual SelectionItem action.
            var root = AutomationElement.FromHandle(window);
            var tabs = root.FindAll(TreeScope.Descendants, new AndCondition(
                new PropertyCondition(AutomationElement.NameProperty, tab.Name),
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.TabItem),
                new PropertyCondition(AutomationElement.IsOffscreenProperty, false),
                new PropertyCondition(AutomationElement.IsEnabledProperty, true)));
            object pattern;
            if (tabs.Count == 1 && tabs[0].TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern))
            {
                ((SelectionItemPattern)pattern).Select();
                return;
            }
        }
        tab.Invoke(true);
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

    public string Share(int screen, string app, bool pickerOnly)
    {
        if (pickerOnly) return WithBackgroundWindow(() => ShareSource(0, null));
        if (screen < 0 || screen > 32 || (screen == 0) == String.IsNullOrWhiteSpace(app))
            throw new ArgumentException("Choose a Discord screen number or an open app.");
        var names = screen != 0
            ? new HashSet<string>(new[] { "Screen " + screen, "Display " + screen, "Entire Screen " + screen }, StringComparer.OrdinalIgnoreCase)
            : WindowNames(app.Trim());
        if (names.Count == 0) throw new InvalidOperationException("Open " + app + " before sharing it on Discord.");
        return WithBackgroundWindow(() => ShareSource(screen, names));
    }

    public string StopShare()
    {
        return WithBackgroundWindow(() => {
            CallView call = OpenConnectedCall();
            if (call == null) return "not-sharing";
            Node stop = CallControl(call, StopButtons);
            if (stop == null)
            {
                Node options = CallControl(call, StreamOptions);
                if (options != null)
                {
                    options.Invoke();
                    stop = WaitFor(() => {
                        CallView view = ConnectedView(call.Channel);
                        if (view == null) return null;
                        return SingleAction(view.Nodes.Where(node => node.Role == MenuItemRole && Within(node, view.Document)), StopButtons) ??
                            CallControl(view, StopButtons);
                    }, 3500);
                }
                else if (!ShowsStream(call) && CallControl(call, ShareButtons) != null)
                    return "not-sharing";
            }
            if (stop == null)
                throw new InvalidOperationException("C.O.D.Y. could not identify your Discord stop-sharing control.");

            stop.Invoke();
            CallView ended = WaitFor(() => {
                CallView view = ConnectedView(call.Channel);
                return view != null && !ShowsStream(view) && CallControl(view, ShareButtons) != null ? view : null;
            }, 4500);
            if (ended == null)
                throw new InvalidOperationException("Discord did not confirm that the screen share stopped.");
            return "stopped";
        });
    }

    private string ShareSource(int screen, HashSet<string> names)
    {
        CallView call = OpenConnectedCall();
        if (call == null)
            throw new InvalidOperationException("Join a Discord voice channel or call before sharing.");
        List<Node> nodes = call.Nodes;
        if (ShowsStream(call))
            throw new InvalidOperationException("Discord is already sharing a source. Stop that share before starting another.");
        Node picker = Picker(nodes);
        if (picker == null)
        {
            Node open = CallControl(call, ShareButtons) ?? WaitFor(() => {
                CallView view = ConnectedView(call.Channel);
                return view == null ? null : CallControl(view, ShareButtons);
            }, 3500);
            if (open == null)
                throw new InvalidOperationException("C.O.D.Y. could not find the screen-share control in your connected Discord call.");
            open.Invoke();
            picker = WaitFor(() => {
                CallView view = ConnectedView(call.Channel);
                if (view == null) return null;
                nodes = view.Nodes;
                return Picker(nodes);
            }, 3500);
        }
        if (picker == null)
            throw new InvalidOperationException("C.O.D.Y. could not identify Discord's share picker. Choose the source in Discord.");
        if (names == null) return "picker";

        string[] category = screen != 0 ? ScreenTabs : AppTabs;
        Node tab = SingleAction(nodes.Where(node => Within(node, picker)), category);
        if (tab == null) return "review";
        if (!tab.Selected) SelectShareTab(tab);
        Source[] sources = WaitFor(() => {
            CallView view = ConnectedView(call.Channel);
            if (view == null) return null;
            nodes = view.Nodes;
            Node current = Picker(view.Nodes);
            if (current == null) return null;
            Node activeTab = SingleAction(nodes.Where(node => Within(node, current)), category);
            if (activeTab == null || !activeTab.Selected) return null;
            Source[] matches = Sources(nodes, current, names);
            return matches.Length == 0 ? null : matches;
        }, 2500);
        if (sources == null || sources.Length != 1) return "review";

        string chosen = sources[0].Label.Name;
        sources[0].Label.CheckCurrent(false);
        sources[0].Action.Invoke();
        var exact = new HashSet<string>(new[] { chosen }, StringComparer.OrdinalIgnoreCase);
        bool selectionConfirmed = false;
        bool startedOnSelection = false;
        Node goLive = WaitFor(() => {
            CallView view = ConnectedView(call.Channel);
            if (view == null) return null;
            nodes = view.Nodes;
            Node current = Picker(view.Nodes);
            if (current == null)
            {
                // Some picker layouts start streaming directly from the source tile.
                Node stop = CallControl(view, StopButtons) ?? CallControl(view, StreamOptions);
                startedOnSelection = stop != null;
                return stop;
            }
            var controls = nodes.Where(node => Within(node, current)).ToArray();
            Source[] options = Sources(nodes, current, exact);
            bool selected = options.Length == 1 && (options[0].Action.Selected || options[0].Label.Selected);
            bool preview = options.Length == 0 && controls.Any(node => exact.Contains(node.Name)) &&
                !controls.Any(node => node.IsAction && (IsNamed(node, ScreenTabs) || IsNamed(node, AppTabs)));
            selectionConfirmed = selected || preview;
            return selectionConfirmed ? SingleAction(controls, GoLiveButtons) : null;
        }, 2200);
        if (startedOnSelection) return "started";
        if (goLive == null) return selectionConfirmed ? "selected" : "review";
        goLive.Invoke();
        return WaitFor(() => {
            CallView view = ConnectedView(call.Channel);
            return view != null && Picker(view.Nodes) == null && ShowsStream(view) ? view : null;
        }, 3800) != null ? "started" : "requested";
    }
}
'@

$command=ConvertFrom-Json -InputObject $Request
$discord=New-Object CodyDiscordControl
if($command.leave -eq $true){
  @{status=$discord.Leave()} | ConvertTo-Json -Compress
}elseif($command.stopShare -eq $true){
  @{status=$discord.StopShare()} | ConvertTo-Json -Compress
}elseif($null -ne $command.feature){
  $result=$discord.Voice([string]$command.feature,[string]$command.state)
  @{enabled=$result.Enabled;changed=$result.Changed} | ConvertTo-Json -Compress
}else{
  @{status=$discord.Share([int]$command.screen,[string]$command.app,[bool]$command.picker)} | ConvertTo-Json -Compress
}
