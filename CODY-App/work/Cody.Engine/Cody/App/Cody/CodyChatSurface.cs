using System;
using System.IO;
using System.Linq;
using HeyClicky.App.Design;
using HeyClicky.App.Notch;
using HeyClicky.App.UI;
using HeyClicky.Core.Notch;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.System;

namespace HeyClicky.App.Cody;

public sealed class CodyChatSurface : NotchSurface
{
    private readonly bool compact;
    private readonly bool focusOnAttach;
    private readonly Grid root = new();
    private readonly StackPanel messages = new() { Spacing = 10 };
    private readonly ScrollViewer scroller;
    private readonly TextBox input;
    private readonly TextBlock status;
    private readonly TextBlock microphoneLabel;
    private readonly TextBlock voiceLabel;
    private Microsoft.UI.Dispatching.DispatcherQueueTimer? pulse;
    private bool attached;
    private bool sending;
    private string lastMessages = "\0";
    public override FrameworkElement View => root;
    public override bool WantsKeyboard => !compact;
    public override bool HoldsKeyboard => !compact && input.FocusState != FocusState.Unfocused;

    public CodyChatSurface(NotchPresentation presentation)
    {
        focusOnAttach = presentation is NotchPresentation.TextInput or NotchPresentation.LiveEvent { Event: NotchLiveEvent.AgentPeek };
        compact = presentation is NotchPresentation.Idle or NotchPresentation.LiveEvent { Event: NotchLiveEvent.DockedIdle };
        root.Width = compact ? 188 : 492;
        root.Height = compact ? 32 : 324;
        root.RowDefinitions.Add(new() { Height = new GridLength(compact ? 32 : 40) });
        root.RowDefinitions.Add(new() { Height = compact ? new GridLength(0) : new GridLength(1, GridUnitType.Star) });
        root.RowDefinitions.Add(new() { Height = compact ? new GridLength(0) : GridLength.Auto });
        var header = new Grid();
        var avatar = new Image { Width = 28, Height = 28, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        string avatarPath = Path.Combine(AppContext.BaseDirectory, "Assets", "Cody", "cody-64.png");
        if (File.Exists(avatarPath)) avatar.Source = new BitmapImage(new Uri(avatarPath));
        AutomationProperties.SetName(avatar, "C.O.D.Y.");
        header.Children.Add(avatar);
        root.Children.Add(header);

        status = Ui.Text("", 11, Microsoft.UI.Text.FontWeights.Normal, DS.Colors.TextSecondary);
        status.VerticalAlignment = VerticalAlignment.Center;
        status.HorizontalAlignment = HorizontalAlignment.Left;
        header.Children.Add(status);
        if (!compact)
        {
            var controls = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Right };
            controls.Children.Add(Button("New", () => CodyConversation.StartFresh()));
            controls.Children.Add(Button("Settings", () => Host.Actions.OpenSettings()));
            header.Children.Add(controls);
        }
        scroller = new ScrollViewer { Content = messages, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollMode = ScrollMode.Disabled, Padding = new Thickness(2, 8, 2, 8), Visibility = compact ? Visibility.Collapsed : Visibility.Visible };
        Grid.SetRow(scroller, 1); root.Children.Add(scroller);

        var composer = new StackPanel { Spacing = 6, Visibility = compact ? Visibility.Collapsed : Visibility.Visible };
        input = new TextBox { PlaceholderText = "Message C.O.D.Y.", Text = CodyConversation.Draft, AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, Height = 52, MaxLength = 12000, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(12), Background = new SolidColorBrush(DS.Colors.Surface1) };
        AutomationProperties.SetName(input, "Message C.O.D.Y.");
        input.TextChanged += (_, _) => CodyConversation.Draft = input.Text;
        input.PointerPressed += (_, _) => FocusInput();
        input.GotFocus += (_, _) => { if (Host != null) { Host.RequestKeyboard(); (Host.Services.Presenter as NotchPresenter)?.SetNotchChatComposerHasKeyboard(true); } };
        input.LostFocus += (_, _) => { if (Host != null) (Host.Services.Presenter as NotchPresenter)?.SetNotchChatComposerHasKeyboard(false); };
        input.PreviewKeyDown += (_, args) => { if (args.Key == VirtualKey.Enter) { args.Handled = true; Send(); } };
        composer.Children.Add(input);
        var row = new Grid();
        microphoneLabel = Ui.Semibold("Listen", 11, DS.Colors.TextPrimary);
        var microphone = Button(microphoneLabel, ToggleMicrophone);
        microphone.HorizontalAlignment = HorizontalAlignment.Left;
        row.Children.Add(microphone);
        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Right };
        voiceLabel = Ui.Semibold("Voice: on", 11, DS.Colors.TextPrimary);
        actions.Children.Add(Button(voiceLabel, () => { Host.Services.Settings.LibraryModeEnabled = !Host.Services.Settings.LibraryModeEnabled; Refresh(); }));
        actions.Children.Add(Button("Stop", () => Host.Services.Companion.Cancel()));
        actions.Children.Add(Button("Send", Send));
        row.Children.Add(actions); composer.Children.Add(row);
        Grid.SetRow(composer, 2); root.Children.Add(composer);
    }

    private static Pressable Button(string label, Action action) => Button(Ui.Semibold(label, 11, DS.Colors.TextPrimary), action);
    private static Pressable Button(TextBlock label, Action action)
    {
        var button = new Pressable { MinWidth = 30, Height = 28, Padding = new Thickness(6, 2, 6, 2), CornerRadius = new CornerRadius(8), Background = Ui.Brush(DS.White(.07)) };
        button.Children.Add(label); button.Click += action;
        AutomationProperties.SetName(button, label.Text);
        return button;
    }

    protected override void OnAttached()
    {
        attached = true;
        if (Host.Services.Companion != null) CodyConversation.Bind(Host.Services.Companion);
        CodyConversation.Changed += QueueRefresh;
        pulse = root.DispatcherQueue.CreateTimer(); pulse.Interval = TimeSpan.FromMilliseconds(120);
        pulse.Tick += (_, _) => { if (Host.Services.Companion != null) CodyConversation.Bind(Host.Services.Companion); Refresh(); };
        pulse.Start(); Refresh();
        if (focusOnAttach) root.DispatcherQueue.TryEnqueue(FocusInput);
    }
    public override void Detached() { attached = false; pulse?.Stop(); CodyConversation.Changed -= QueueRefresh; }
    public override void FocusInput()
    {
        if (compact || !attached) return;
        var presenter = Host.Services.Presenter as NotchPresenter;
        if (presenter != null && !presenter.IsNotchChatSessionOpen) presenter.OpenNotchChatSession(NotchChatSessionOpenVia.ComposerClick);
        Host.RequestKeyboard();
        input.Focus(FocusState.Programmatic);
        presenter?.Tabs.ConsumeComposerFocusRequest();
    }
    public override bool CanUpdate(NotchPresentation p) => CodyChrome.Handles(p, Host) && (p is NotchPresentation.Idle or NotchPresentation.LiveEvent { Event: NotchLiveEvent.DockedIdle }) == compact;
    public override void Update(NotchPresentation p) => Refresh();
    private void QueueRefresh() => root.DispatcherQueue.TryEnqueue(Refresh);

    private void Refresh()
    {
        if (!attached) return;
        var engine = Host.Services.Companion;
        if (engine == null) { status.Text = "Starting"; return; }
        status.Text = Host.Services.Auth.IsSignedIn ? engine.State switch { VoiceState.Listening => "Listening", VoiceState.Processing => "Thinking", VoiceState.Responding => "Responding", _ => compact ? "" : "C.O.D.Y." } : "Sign in required";
        voiceLabel.Text = Host.Services.Settings.LibraryModeEnabled ? "Voice: on" : "Voice: off";
        if (voiceLabel.Parent is Pressable voiceButton) AutomationProperties.SetName(voiceButton, voiceLabel.Text);
        microphoneLabel.Text = engine.State == VoiceState.Listening ? "Finish" : "Listen";
        string content = string.Join("\n", CodyConversation.Messages.Select(m => m.Role + ":" + m.Text)) + CodyConversation.Error;
        if (content == lastMessages) return; lastMessages = content;
        messages.Children.Clear();
        if (CodyConversation.Messages.Count == 0) messages.Children.Add(Ui.Text("How can I help?", 21, Microsoft.UI.Text.FontWeights.SemiBold, DS.Colors.TextPrimary));
        foreach (var message in CodyConversation.Messages)
        {
            var text = Ui.Text(message.Text, 13, Microsoft.UI.Text.FontWeights.Normal, DS.Colors.TextPrimary); text.TextWrapping = TextWrapping.Wrap; text.IsTextSelectionEnabled = true;
            var bubble = new Border { Child = text, Padding = new Thickness(12, 9, 12, 9), CornerRadius = new CornerRadius(14), MaxWidth = 440, HorizontalAlignment = message.Role == "user" ? HorizontalAlignment.Right : HorizontalAlignment.Left, Background = Ui.Brush(message.Role == "user" ? DS.Colors.Surface2 : DS.White(.015)) };
            messages.Children.Add(bubble);
        }
        if (CodyConversation.Error != null) messages.Children.Add(Ui.Text(CodyConversation.Error, 11, Microsoft.UI.Text.FontWeights.Normal, DS.Colors.Destructive));
        scroller.ChangeView(null, scroller.ScrollableHeight, null);
    }

    private async void Send()
    {
        string text = input.Text.Trim();
        if (text.Length == 0 || sending || Host.Services.Companion == null) return;
        if (!Host.Services.Auth.IsSignedIn) { Host.Actions.SignIn(); return; }
        sending = true; input.Text = ""; CodyConversation.Draft = ""; CodyConversation.BeginUserMessage(text);
        try { await Host.Services.Companion.SubmitTextAsync(text); }
        catch (Exception error) { CodyConversation.SetError(error.Message); }
        finally { sending = false; }
    }

    private async void ToggleMicrophone()
    {
        if (Host.Services.Companion == null) return;
        if (!Host.Services.Auth.IsSignedIn) { Host.Actions.SignIn(); return; }
        try
        {
            if (Host.Services.Companion.State == VoiceState.Listening) await Host.Services.Companion.EndPushToTalkAsync();
            else await Host.Services.Companion.BeginPushToTalkAsync();
        }
        catch (Exception error) { CodyConversation.SetError(error.Message); }
    }
}

