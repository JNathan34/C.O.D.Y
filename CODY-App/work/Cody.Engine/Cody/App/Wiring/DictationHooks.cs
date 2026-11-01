using System;

namespace HeyClicky.App.Wiring;

public static class DictationHooks
{
	public static volatile Action<string>? RemoveLearnedWord;
}
