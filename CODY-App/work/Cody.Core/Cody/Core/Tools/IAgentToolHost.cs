using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace HeyClicky.Core.Tools;

public interface IAgentToolHost
{
	IReadOnlyList<AgentClickyInfo> Clickys { get; }

	IReadOnlyList<AgentTaskInfo> Tasks { get; }

	string ProjectsRoot { get; }

	AgentClickyInfo? FindClicky(string slug);

	string? WorkspacePath(string clickySlug);

	Task<string> LaunchAsync(AgentToolLaunch launch, CancellationToken ct);

	Task SteerAsync(string taskId, string text, CancellationToken ct);

	string OpenThread(string threadId);

	Task StopAsync(string taskId);

	Task ApproveExtraUsageAsync(string taskId, bool asManyAsNeeded, CancellationToken ct);

	AgentClickyInfo CreateClicky(string name, string roleText, string oneLiner);

	Task<IReadOnlyList<(string Role, string Text)>> RecentMessagesAsync(string threadId, int limit, CancellationToken ct);

	Task<IReadOnlyList<AgentThreadInfo>> HistoryAsync(int limit, CancellationToken ct);

	bool OpenHome(string? threadId);

	bool CloseHome();

	bool OpenPath(string pathOrUrl);

	bool RevealPath(string path);

	bool SkipOnboardingInterview();

	AgentJobInfo? FindJob(string threadId)
	{
		return null;
	}

	string? ClickySlugForThread(string threadId)
	{
		return Clickys.FirstOrDefault((AgentClickyInfo c) => c.ThreadId == threadId)?.Slug;
	}

	Task<string?> HandleSuggestionActionAsync(string task)
	{
		return Task.FromResult<string>(null);
	}

	void ApproveComputerUse(string taskId)
	{
	}

	void DeclineComputerUse(string taskId)
	{
	}
}
