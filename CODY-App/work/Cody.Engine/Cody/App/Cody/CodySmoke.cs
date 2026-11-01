using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using HeyClicky.Core.Voice;

namespace HeyClicky.App.Cody;

// Explicit developer test, never run by the normal launcher.
public static class CodySmoke
{
    public static async void Run(AppHost host)
    {
        if (!Program.Args.Contains("--cody-smoke")) return;
        string path = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../reports/native-engine-smoke.json"));
        try
        {
            var engine = (CompanionSession)host.Services.Companion;
            host.ShowInChat(null, null);
            int before = engine.AudioPlaybackBeganCount;
            string prompt = "Say hello in one short sentence, then show me an interactive 3D model of a bicycle using your 3D drawing tools.";
            CodyConversation.Bind(engine);
            CodyConversation.BeginUserMessage(prompt);
            var turn = engine.SubmitTextAsync(prompt, true);
            if (await Task.WhenAny(turn, Task.Delay(TimeSpan.FromSeconds(150))) != turn)
                throw new TimeoutException("The native session did not complete within 150 seconds.");
            await turn;
            await Task.Delay(2000);
            File.WriteAllText(path, JsonSerializer.Serialize(new { completed = true, response = engine.ResponseText, state = engine.State.ToString(), audioPlaybackStarts = engine.AudioPlaybackBeganCount - before, error = CodyConversation.Error }, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch (Exception error)
        {
            File.WriteAllText(path, JsonSerializer.Serialize(new { completed = false, error = error.ToString() }, new JsonSerializerOptions { WriteIndented = true }));
        }
    }
}
