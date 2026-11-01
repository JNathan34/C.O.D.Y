using System;
using HeyClicky.App.Cody;
int checks=0;
void Equal(string actual,string expected){checks++;if(actual!=expected)throw new Exception($"Expected '{expected}', got '{actual}'");}
Equal(CodyIdentity.ForSpeech("C.O.D.Y. is ready."),"Cody is ready.");
Equal(CodyIdentity.ForSpeech("C.O.D.Y wins!"),"Cody wins!");
Equal(CodyIdentity.ForSpeech("Ask CODY to help."),"Ask Cody to help.");
Equal(CodyIdentity.ForSpeech("CODYesque and my_CODY_file are unchanged."),"CODYesque and my_CODY_file are unchanged.");
Equal(CodyIdentity.ForSpeech("Sign in to HeyClicky."),"Sign in to HeyClicky.");
Equal(CodyIdentity.ForSpeech("C. O. D. Y. can help."),"Cody can help.");
string note="[Your jobs]\nExisting task is waiting for browser setup.";
checks++;if(!CodyIdentity.Context(note).EndsWith(note,StringComparison.Ordinal))throw new Exception("Existing job context was lost.");
checks++;if(!CodyIdentity.Context(note).Contains("C.O.D.Y.")||!CodyIdentity.Context(note).Contains("Cody"))throw new Exception("Identity instructions missing.");
Console.WriteLine($"{checks} identity and pronunciation checks passed.");
