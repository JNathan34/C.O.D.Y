using System;
using System.Collections.Generic;
using System.Linq;

namespace HeyClicky.Core.Dictation;

public static class DictationLanguageCatalog
{
	public const string MultilingualCode = "multi";

	public const string DefaultSpecificCode = "en";

	private static readonly string[] PopularCodes = new string[12]
	{
		"en", "es", "fr", "de", "hi", "zh", "ja", "ko", "pt", "ru",
		"ar", "it"
	};

	public static readonly IReadOnlyList<DictationLanguage> Specific = new _003C_003Ez__ReadOnlyArray<DictationLanguage>(new DictationLanguage[50]
	{
		new DictationLanguage("ar", "Arabic", "العربية"),
		new DictationLanguage("be", "Belarusian", "Беларуская"),
		new DictationLanguage("bn", "Bengali", "ব\u09be\u0982ল\u09be"),
		new DictationLanguage("bs", "Bosnian", "Bosanski"),
		new DictationLanguage("bg", "Bulgarian", "Български"),
		new DictationLanguage("ca", "Catalan", "Català"),
		new DictationLanguage("zh", "Chinese", "中文"),
		new DictationLanguage("hr", "Croatian", "Hrvatski"),
		new DictationLanguage("cs", "Czech", "Čeština"),
		new DictationLanguage("da", "Danish", "Dansk"),
		new DictationLanguage("nl", "Dutch", "Nederlands"),
		new DictationLanguage("en", "English", null),
		new DictationLanguage("et", "Estonian", "Eesti"),
		new DictationLanguage("fi", "Finnish", "Suomi"),
		new DictationLanguage("fr", "French", "Français"),
		new DictationLanguage("de", "German", "Deutsch"),
		new DictationLanguage("el", "Greek", "Ελληνικά"),
		new DictationLanguage("gu", "Gujarati", "ગ\u0ac1જર\u0abeત\u0ac0"),
		new DictationLanguage("he", "Hebrew", "עברית"),
		new DictationLanguage("hi", "Hindi", "ह\u093fन\u094dद\u0940"),
		new DictationLanguage("hu", "Hungarian", "Magyar"),
		new DictationLanguage("id", "Indonesian", "Bahasa Indonesia"),
		new DictationLanguage("it", "Italian", "Italiano"),
		new DictationLanguage("ja", "Japanese", "日本語"),
		new DictationLanguage("kn", "Kannada", "ಕನ\u0ccdನಡ"),
		new DictationLanguage("ko", "Korean", "한국어"),
		new DictationLanguage("lv", "Latvian", "Latviešu"),
		new DictationLanguage("lt", "Lithuanian", "Lietuvių"),
		new DictationLanguage("mk", "Macedonian", "Македонски"),
		new DictationLanguage("ms", "Malay", "Bahasa Melayu"),
		new DictationLanguage("mr", "Marathi", "मर\u093eठ\u0940"),
		new DictationLanguage("no", "Norwegian", "Norsk"),
		new DictationLanguage("fa", "Persian", "فارسی"),
		new DictationLanguage("pl", "Polish", "Polski"),
		new DictationLanguage("pt", "Portuguese", "Português"),
		new DictationLanguage("ro", "Romanian", "Română"),
		new DictationLanguage("ru", "Russian", "Русский"),
		new DictationLanguage("sr", "Serbian", "Српски"),
		new DictationLanguage("sk", "Slovak", "Slovenčina"),
		new DictationLanguage("sl", "Slovenian", "Slovenščina"),
		new DictationLanguage("es", "Spanish", "Español"),
		new DictationLanguage("sv", "Swedish", "Svenska"),
		new DictationLanguage("tl", "Tagalog", "Tagalog"),
		new DictationLanguage("ta", "Tamil", "தம\u0bbfழ\u0bcd"),
		new DictationLanguage("te", "Telugu", "త\u0c46ల\u0c41గ\u0c41"),
		new DictationLanguage("th", "Thai", "ไทย"),
		new DictationLanguage("tr", "Turkish", "Türkçe"),
		new DictationLanguage("uk", "Ukrainian", "Українська"),
		new DictationLanguage("ur", "Urdu", "اردو"),
		new DictationLanguage("vi", "Vietnamese", "Tiếng Việt")
	});

	public static IReadOnlyList<DictationLanguage> ForPicker()
	{
		Dictionary<string, DictationLanguage> byCode = Specific.ToDictionary((DictationLanguage l) => l.Code);
		IEnumerable<DictationLanguage> collection = from c in PopularCodes.Where(byCode.ContainsKey)
			select byCode[c];
		List<DictationLanguage> list = new List<DictationLanguage>();
		list.AddRange(collection);
		list.AddRange(Specific.Where((DictationLanguage l) => !Enumerable.Contains(PopularCodes, l.Code)).OrderBy((DictationLanguage l) => l.DisplayName, StringComparer.Ordinal));
		return new _003C_003Ez__ReadOnlyList<DictationLanguage>(list);
	}

	public static bool IsKnownSpecific(string? code)
	{
		if (code != null)
		{
			return Specific.Any((DictationLanguage l) => l.Code == code);
		}
		return false;
	}
}
