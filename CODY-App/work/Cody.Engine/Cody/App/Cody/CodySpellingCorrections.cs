using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
namespace HeyClicky.App.Cody;
internal static partial class CodyProofread{
    internal static readonly Regex Words=new(@"\p{L}[\p{L}\p{M}'’]*",RegexOptions.Compiled);
    internal static string Apply(string source,string response)
    {
        // Some engine responses wrap speech in say("..."). Never execute it.
        string json=response.Trim();
        if(json.StartsWith("```")){int first=json.IndexOf('\n');int last=json.LastIndexOf("```");if(first>=0&&last>first)json=json[(first+1)..last].Trim();}
        if(json.StartsWith("say(")){int end=json.LastIndexOf(')');if(end<4)throw new InvalidOperationException("Spell check returned an unreadable response.");json=JsonSerializer.Deserialize<string>(json[4..end].Trim());}
        using var document=JsonDocument.Parse(json);
        var changes=document.RootElement.GetProperty("corrections");if(changes.ValueKind!=JsonValueKind.Array)throw new InvalidOperationException("Invalid spelling corrections.");
        var words=Words.Matches(source).Cast<Match>().ToArray();var edits=new SortedDictionary<int,string>();
        foreach(var item in changes.EnumerateArray()){
            int index=item.GetProperty("index").GetInt32();string replacement=item.GetProperty("replacement").GetString();
            if(index<0||index>=words.Length||edits.ContainsKey(index)||string.IsNullOrEmpty(replacement)||!Regex.IsMatch(replacement,@"^\p{L}[\p{L}\p{M}'’]*$")||Distance(words[index].Value,replacement)>Math.Clamp(words[index].Length/3,2,3))throw new InvalidOperationException("Spell check suggested a larger rewrite. Your text was left unchanged.");
            var word=words[index];int left=word.Index;while(left>0&&!char.IsWhiteSpace(source[left-1]))left--;int right=word.Index+word.Length;while(right<source.Length&&!char.IsWhiteSpace(source[right]))right++;
            string surrounding=source[left..right];if(surrounding.Contains('@')||surrounding.Contains("://")||surrounding.Contains('\\')||Regex.IsMatch(surrounding,@"\w\.\w"))continue;
            edits[index]=replacement;
        }
        var output=new StringBuilder(source);foreach(var edit in edits.Reverse()){var word=words[edit.Key];output.Remove(word.Index,word.Length).Insert(word.Index,edit.Value);}return output.ToString();
    }
    private static int Distance(string a,string b){a=a.ToLowerInvariant();b=b.ToLowerInvariant();if(Math.Abs(a.Length-b.Length)>3)return 4;int[] row=Enumerable.Range(0,b.Length+1).ToArray();for(int i=1;i<=a.Length;i++){int diagonal=row[0];row[0]=i;for(int j=1;j<=b.Length;j++){int old=row[j];row[j]=Math.Min(Math.Min(row[j]+1,row[j-1]+1),diagonal+(a[i-1]==b[j-1]?0:1));diagonal=old;}}return row[b.Length];}
}
