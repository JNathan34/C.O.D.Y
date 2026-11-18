using System;
using System.Text.RegularExpressions;
using HeyClicky.Core.Browser;
namespace HeyClicky.App.Cody;
internal static class CodyCommunication
{
    private const string ChatCodeInstructions="\nWhen the user asks to see source code, give the actual example in chat, even on a voice turn. Put each example in a tilde Markdown fence, such as ~~~html or ~~~python, closed by ~~~ on its own line. Include the complete fenced example in one single- or double-quoted say() string with escaped newlines so the chat preserves indentation. Treat the example as literal text, not as a program to execute or a drawing to show. Keep any spoken introduction short.";
    internal const string Instructions="[C.O.D.Y. communication preference]\nBe direct and brief. When performing an app action or using computer control, give at most one short acknowledgement at the start, then work quietly. Do not narrate clicks, mouse movement, choices, individual quiz answers or routine progress. Do not repeat the acknowledgement when control starts. Only interrupt for a genuinely necessary question, approval, blocker or important failure. At the end, give one short verified result; for a quiz include the actual observed score if available. Never invent a score or claim completion without checking. If the user explicitly asks for explanations or live narration, follow that request; otherwise quiet execution is the default. This controls communication, not permissions or which actions are allowed.";
    internal static string ChatInstructions => Instructions + ChatCodeInstructions;
    private static readonly Regex CodeStart = new(@"^[ \t]*(?:`{3,}|~{3,}|<!doctype\s+html\b|<(?:html|head|body|main|div|script|style|p|h[1-6])(?:[ \t>]))", RegexOptions.Multiline | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    internal static string ChatReplyForSpeech(string text)
    {
        var code = CodeStart.Match(text);
        if (!code.Success) return text;
        string intro = text[..code.Index].Trim();
        return intro.Length > 0 ? intro : "The code is in chat.";
    }

    internal static string DriveFact(string goal,string helper){
        string owner=string.IsNullOrWhiteSpace(helper)?"":" A background helper requested only this screen step; complete that step and return its verified outcome and any output paths in end_screen_takeover's summary.";
        var target=WindowsBrowserPreference.Current?.AutomationTarget();
        string browser=target?.Error is string error
            ? "\nIf this task needs to open a browser, tell the user: "+error
            : "\nIf this task needs to open a browser, use "+(target?.Name??"the Windows default browser")+" unless the user named a different browser or asked about an existing tab or window.";
        return "[Take-over] The user approved computer control for: "+goal+"."+owner+"\n"+Instructions+browser+"\nUse the computer tool directly and efficiently. Related safe actions can be grouped when the next state is predictable; observe again when needed. There is no requirement to speak before an action group. The initial acknowledgement may already have been spoken: do not repeat it. Unless the user explicitly requested live narration, omit intermediate say/narration lines entirely. When finished, verify the visible outcome, give one short final result, include that same verified result in end_screen_takeover's summary, and stop acting. For a quiz, report the observed score, such as 10/10 only if the screen actually shows it. If the score is unavailable, say so briefly instead of guessing.";
    }
    internal static bool WaitForActionNarration(bool codyMode)=>!codyMode;
}
