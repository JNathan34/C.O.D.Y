namespace HeyClicky;

public sealed record HotkeyBindings(HotkeyBinding PushToTalk, HotkeyBinding TextMode, HotkeyBinding Dictation, HotkeyBinding HandsFreeDictation)
{
	public static readonly HotkeyBindings Defaults = new HotkeyBindings(HotkeyBinding.PushToTalkDefault, HotkeyBinding.TextModeDefault, HotkeyBinding.DictationDefault, HotkeyBinding.HandsFreeDictationDefault);
}
