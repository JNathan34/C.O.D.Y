namespace HeyClicky.Core.Platform;

internal static class TextEntryFeedback
{
    internal static string Message(TextInsertOutcome outcome) => outcome.Reason switch
    {
        "own_window" => "C.O.D.Y.’s chat box has focus. Click the text field in the app you want to use, then ask again by voice so the field stays focused.",
        "no_focused_text_field" => "Click the editable text field you want to use, then ask again by voice so the field stays focused.",
        "secure_field" => "This is a password or protected field. Enter its text yourself.",
        "address_bar" => "The browser address bar has focus. Click the text field on the page you want to use.",
        null or "" or "unsafe_target" or "paste_failed" =>
            "C.O.D.Y. could not verify the intended field. Click an editable text field and check it before trying again.",
        _ => outcome.Reason
    };
}
