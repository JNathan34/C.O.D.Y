using System;
using System.Collections.Generic;
using System.Linq;
namespace HeyClicky.App.Cody;
internal static class CodyCancellationTarget
{
    internal sealed record Work(string Id,string Thread,string Turn,DateTimeOffset Started);
    internal static string Select(IEnumerable<Work> work,string driveThread,string turn,bool allowFallback=true){
        var active=work.ToArray();
        // A drive owned by a job must never cancel an unrelated parallel job.
        if(!string.IsNullOrEmpty(driveThread))return active.Where(x=>x.Thread==driveThread).OrderByDescending(x=>x.Started).FirstOrDefault()?.Id;
        if(!allowFallback)active=active.Where(x=>!string.IsNullOrEmpty(turn)&&x.Turn==turn).ToArray();
        return active.OrderByDescending(x=>!string.IsNullOrEmpty(turn)&&x.Turn==turn).ThenByDescending(x=>x.Started).FirstOrDefault()?.Id;
    }
}
