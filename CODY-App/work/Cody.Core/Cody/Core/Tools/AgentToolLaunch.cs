using System;
using System.Collections.Generic;

namespace HeyClicky.Core.Tools;

public sealed record AgentToolLaunch(string Prompt, string? ClickySlug = null, string? NewClickyName = null, string NewClickyRole = "Helper", string? NewClickyOneLiner = null, string? LaunchContext = null, string LaunchSource = "voice", IReadOnlyList<byte[]>? ImagesJpeg = null, IReadOnlyList<string>? AttachedFilePaths = null, string UsageContext = "companion", bool AsJob = false, string? ChromeChoice = null)
{
	public bool IsGeneratedTaskBrief => !RelaysUsersOwnRequest;

	public bool RelaysUsersOwnRequest
	{
		get
		{
			string launchSource = LaunchSource;
			if ((launchSource == "text" || launchSource == "voice") ? true : false)
			{
				string launchContext = LaunchContext;
				if (launchContext != null && launchContext.Contains("<REALTIME_AGENT_HANDOFF>", StringComparison.Ordinal) && launchContext.Contains("Original user request (typed/STT text):", StringComparison.Ordinal))
				{
					return !launchContext.Contains("(not available at tool dispatch time)", StringComparison.Ordinal);
				}
			}
			return false;
		}
	}
}
