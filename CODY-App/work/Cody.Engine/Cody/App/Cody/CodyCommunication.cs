using System;
namespace HeyClicky.App.Cody;
internal static class CodyCommunication
{
    internal const string Instructions="[C.O.D.Y. communication preference]\nBe direct and brief. When performing an app action or using computer control, give at most one short acknowledgement at the start, then work quietly. Do not narrate clicks, mouse movement, choices, individual quiz answers or routine progress. Do not repeat the acknowledgement when control starts. Only interrupt for a genuinely necessary question, approval, blocker or important failure. At the end, give one short verified result; for a quiz include the actual observed score if available. Never invent a score or claim completion without checking. If the user explicitly asks for explanations or live narration, follow that request; otherwise quiet execution is the default. This controls communication, not permissions or which actions are allowed.";
    internal static string DriveFact(string goal,string helper){
        string owner=string.IsNullOrWhiteSpace(helper)?"":" A background helper requested only this screen step; complete that step and return its verified outcome and any output paths in end_screen_takeover's summary.";
        return "[Take-over] The user approved computer control for: "+goal+"."+owner+"\n"+Instructions+"\nUse the computer tool directly and efficiently. Related safe actions can be grouped when the next state is predictable; observe again when needed. There is no requirement to speak before an action group. The initial acknowledgement may already have been spoken: do not repeat it. Unless the user explicitly requested live narration, omit intermediate say/narration lines entirely. When finished, verify the visible outcome, give one short final result, include that same verified result in end_screen_takeover's summary, and stop acting. For a quiz, report the observed score, such as 10/10 only if the screen actually shows it. If the score is unavailable, say so briefly instead of guessing.";
    }
    internal static bool WaitForActionNarration(bool codyMode)=>!codyMode;
}
