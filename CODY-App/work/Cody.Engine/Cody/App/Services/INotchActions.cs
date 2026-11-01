using System.Collections.Generic;
using HeyClicky.Core.Notch;

namespace HeyClicky.App.Services;

public interface INotchActions
{
	void SubmitChatText(string text, IReadOnlyList<string> files);

	void OpenChatArtifact(string entry, string? threadId, string? clickySlug);

	void SendChatFollowUp(ChatHandOff entry, string followUp);

	void OpenInItsApp(string path, string? threadId);

	void RevealInExplorer(string path);

	void PlayDrawing(string lessonId, bool onWhiteBoard);
}
