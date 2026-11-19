using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace HeyClicky.Core.Brain
{
    public class BrainReplyAccumulator
    {
        public bool SpeechOnly { get; set; }
        public string RawText = "";
        public ReplyData Reply = new();
    }
    public class ReplyData { public string Error; }
}
namespace HeyClicky.App.Cody
{
    internal static class CodyMemoryPolicy
    {
        internal static bool LocalOnly => false;
        internal static string BlockedMessage => "Local only";
    }
    internal class AppHost { internal RealHost Real = new(); }
    internal class RealHost { internal CoreHost Core = new(); }
    internal class CoreHost { internal AuthHost Auth = new(); internal BrainClient BrainClient = new(); }
    internal class AuthHost
    {
        internal Task<string> GetValidAccessTokenAsync(CancellationToken token) => Task.FromResult("test-token");
    }
    internal class BrainClient
    {
        internal Queue<string> Replies = new();
        internal int Calls;
        internal string Error;
        internal Task StreamTurnAsync(Action<Utf8JsonWriter> write, string token, string mode,
            HeyClicky.Core.Brain.BrainReplyAccumulator reply, CancellationToken cancellation)
        {
            cancellation.ThrowIfCancellationRequested();
            using var stream = new MemoryStream();
            using (var writer = new Utf8JsonWriter(stream)) write(writer);
            using var body = JsonDocument.Parse(stream.ToArray());
            if (body.RootElement.GetProperty("max_rounds").GetInt32() != 1 ||
                !body.RootElement.GetProperty("screenless").GetBoolean() ||
                body.RootElement.GetProperty("async_tools").GetBoolean()) throw new Exception("Unsafe planning request");
            Calls++;
            reply.RawText = Replies.Dequeue();
            reply.Reply.Error = Error;
            return Task.CompletedTask;
        }
    }
}
