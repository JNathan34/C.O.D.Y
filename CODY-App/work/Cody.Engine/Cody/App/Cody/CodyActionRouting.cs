using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
namespace HeyClicky.App.Cody;
internal static class CodyActionRouting
{
    internal const string ForegroundSource="cody-foreground";
    internal const string Instructions="[C.O.D.Y. action routing]\nTreat short, immediate app operations as foreground actions, not background jobs. This applies across apps: messaging a person or a self/Notes chat, replying, muting/deafening Discord, joining/leaving calls, opening or switching apps, and playing/pausing/seeking/resuming media in Plezy or another player. Prefer a connected plugin or existing local action that actually supports the operation. A linked plugin may not support every local app control; if it cannot do it, use computer control now. With no supporting plugin/tool, use offer_screen_takeover/start_screen_takeover and perform the action directly. Do not call sessions_spawn, create a saved job, make a plan or hand off ordinary app control. Preserve the recipient, exact message text, app and requested action. Plex requests mean Plezy. Confirm only genuinely missing details and existing approval requirements; do not replace a request to send with an unrequested draft, or send a message when only a draft was requested. Stop after the requested result and verify it before claiming success. Use a short acknowledgement. Keep sessions_spawn for substantial deliverables/research, genuinely long work, explicit background work, schedules and monitoring. This preference is about routing and does not bypass permissions, send confirmations, account checks or paid usage limits.";
    private static readonly Regex Verb=new(@"^(?:send|message|text|tell|dm|reply|respond|mute|unmute|deafen|undeafen|join|leave|call|hang\s+up|play|pause|resume|stop|skip|seek|rewind|fast\s*forward|turn|set|adjust|increase|decrease|raise|lower|open|launch|close|switch|pin|unpin|move|resize|go\s+(?:to|into)|put\s+on|like|react|mark|archive|delete|remove|add|change|toggle)\b",RegexOptions.IgnoreCase|RegexOptions.CultureInvariant);
    internal static bool Immediate(string text){
        if(string.IsNullOrWhiteSpace(text))return false;
        string command=Regex.Replace(text.Trim(),@"^(?:(?:hey\s+)?c\.?o\.?d\.?y\.?[, ]+|(?:can|could|would|will)\s+you\s+|please\s+|i\s+(?:want|need)\s+(?:you\s+)?to\s+)+","",RegexOptions.IgnoreCase);
        if(Regex.IsMatch(command,@"^(?:schedule|research|build|create|write|design|generate|monitor|watch|keep|remind|make|plan|analyse|analyze)\b",RegexOptions.IgnoreCase))return false;
        if(Regex.IsMatch(command,@"^(?:start|run|launch|set\s+up)\s+(?:a\s+|an\s+)?(?:background|agent|helper|job|routine|monitor|schedule)\b|\b(?:in\s+the\s+background|as\s+a\s+background\s+(?:task|job))\b",RegexOptions.IgnoreCase))return false;
        if(Regex.IsMatch(command,@"^(?:add|change|update|remove)\b.*\b(?:codebase|repository|unit tests|integration|feature)\b",RegexOptions.IgnoreCase))return false;
        string intent=Regex.Replace(command,"""(?<![\p{L}\p{N}])(["']).*?\1""","");
        if(Regex.IsMatch(intent,@"\b(?:tomorrow|tonight|later|next\s+(?:week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b|\bin\s+\d+\s+(?:minutes?|hours?|days?)\b|\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\bevery\s+(?:day|week|month|morning|evening)\b",RegexOptions.IgnoreCase))return false;
        return Verb.IsMatch(command);
    }
    internal static string ConnectedApp(string request,IEnumerable<string> connected){
        string words=" "+Regex.Replace(request??"",@"[^\p{L}\p{N}]"," ").ToLowerInvariant()+" ";
        if(words.Contains(" plex ",StringComparison.Ordinal)||words.Contains(" plezy ",StringComparison.Ordinal))return connected.FirstOrDefault(x=>string.Equals(x,"plezy",StringComparison.OrdinalIgnoreCase));
        return connected.Where(x=>!string.IsNullOrWhiteSpace(x)).OrderByDescending(x=>x.Length).FirstOrDefault(app=>{
            string name=app.Replace("custom:","",StringComparison.OrdinalIgnoreCase).Replace("_"," ").Replace("-"," ").ToLowerInvariant();
            return words.Contains(" "+name+" ",StringComparison.Ordinal)||new[]{"google","microsoft","apple"}.Any(prefix=>name.StartsWith(prefix,StringComparison.Ordinal)&&words.Contains(" "+name[prefix.Length..].Trim()+" ",StringComparison.Ordinal));
        });
    }
}
