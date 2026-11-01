using System;
using HeyClicky.App.Cody;
class Program{
 static int count;
 static void Equal(string source,string response,string expected){var actual=CodyProofread.Apply(source,response);if(actual!=expected)throw new Exception("Unexpected spelling result: "+actual);count++;}
 static void Refuse(string response){try{CodyProofread.Apply("helo world",response);}catch{count++;return;}throw new Exception("Accepted unsafe rewrite");}
 static void Main(){
 Equal("  helo,\r\nworld!  ","{\"corrections\":[{\"index\":0,\"replacement\":\"hello\"}]}","  hello,\r\nworld!  ");
 Equal("all good", "{\"corrections\":[]}","all good");
 Equal("my favrite colour", "{\"corrections\":[{\"index\":1,\"replacement\":\"favourite\"}]}","my favourite colour");
 Equal("helo@example.com", "{\"corrections\":[{\"index\":0,\"replacement\":\"hello\"}]}","helo@example.com");
 Equal("https://helo.test", "{\"corrections\":[{\"index\":1,\"replacement\":\"hello\"}]}","https://helo.test");
 Equal("helo", "say(\"{\\\"corrections\\\":[]}\")","helo");
 Refuse("{\"corrections\":[{\"index\":0,\"replacement\":\"a whole sentence\"}]}");
 Refuse("{\"corrections\":[{\"index\":0,\"replacement\":\"completely\"}]}");
 Refuse("{\"corrections\":[{\"index\":42,\"replacement\":\"hello\"}]}");
 Refuse("{\"corrections\":[{\"index\":0,\"replacement\":\"hello\"},{\"index\":0,\"replacement\":\"help\"}]}");
 Refuse("Sorry, I cannot see that text box.");
 Console.WriteLine(count+" spelling preservation checks passed.");
 }
}
