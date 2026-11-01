using System;
using System.Collections.Generic;
using HeyClicky.App.Notch;
using HeyClicky.App.Services;
using HeyClicky.Core.Notch;

namespace HeyClicky.App.Cody;

public static class CodyChrome
{
    public static bool Enabled => true;
    public static INotchHost? Host { get; set; }

    public static bool Handles(NotchPresentation presentation, INotchHost? host = null)
    {
        if (presentation is NotchPresentation.LiveEvent { Event: NotchLiveEvent.DockedIdle or NotchLiveEvent.ActivityListening or NotchLiveEvent.ActivityThinking or NotchLiveEvent.ActivitySpeaking }) return true;
        if (presentation is NotchPresentation.Idle or NotchPresentation.TextInput or NotchPresentation.TextResponse)
            return true;
        return presentation is NotchPresentation.LiveEvent { Event: NotchLiveEvent.AgentPeek }
            && ((host ?? Host)?.Services.Presenter as NotchPresenter)?.Tabs.Selected is NotchTab.Home or NotchTab.Chat;
    }

    public static bool TrySize(NotchPresentation presentation, out (double W, double H) size)
    {
        size = presentation is NotchPresentation.Idle or NotchPresentation.LiveEvent { Event: NotchLiveEvent.DockedIdle } ? (216, 32) : (520, 352);
        return Handles(presentation);
    }
}

// A view model for the actual native HeyClicky session. No separate AI, STT,
// TTS or model generator is introduced by the replacement frontend.
public static class CodyConversation
{
    public sealed record Message(string Role, string Text);
    private static ICompanionSession? session;
    private static int currentUser = -1;
    private static int currentAssistant = -1;
    public static List<Message> Messages { get; } = new();
    public static string Draft { get; set; } = "";
    public static string? Error { get; private set; }
    public static event Action? Changed;

    public static void Bind(ICompanionSession next)
    {
        if (ReferenceEquals(session, next)) return;
        if (session != null)
        {
            session.StateChanged -= StateChanged;
            session.UserTranscriptUpdated -= TranscriptChanged;
            session.ResponseTextUpdated -= ResponseChanged;
            session.Failed -= Failed;
        }
        session = next;
        session.StateChanged += StateChanged;
        session.UserTranscriptUpdated += TranscriptChanged;
        session.ResponseTextUpdated += ResponseChanged;
        session.Failed += Failed;
    }

    public static void BeginUserMessage(string text)
    {
        Error = null;
        currentUser = Messages.Count;
        currentAssistant = -1;
        Messages.Add(new("user", text));
        Changed?.Invoke();
    }

    public static void StartFresh()
    {
        (session as HeyClicky.Core.Voice.CompanionSession)?.StartFreshSession();
        Messages.Clear(); currentUser = currentAssistant = -1; Draft = ""; Error = null;
        Changed?.Invoke();
    }

    public static void SetError(string message) { Error = message; Changed?.Invoke(); }
    private static void StateChanged(object? sender, EventArgs args)
    {
        if (session?.State == VoiceState.Listening) { currentUser = currentAssistant = -1; Error = null; }
        Changed?.Invoke();
    }
    private static void TranscriptChanged(object? sender, string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return;
        if (currentUser < 0) { currentUser = Messages.Count; Messages.Add(new("user", text)); }
        else Messages[currentUser] = new("user", text);
        Changed?.Invoke();
    }
    private static void ResponseChanged(object? sender, string text)
    {
        if (currentAssistant < 0) { currentAssistant = Messages.Count; Messages.Add(new("assistant", text)); }
        else Messages[currentAssistant] = new("assistant", text);
        Changed?.Invoke();
    }
    private static void Failed(object? sender, CompanionError error) => SetError(error.Message);
}
