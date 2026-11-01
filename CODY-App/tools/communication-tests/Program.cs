using HeyClicky.App.Cody;
int checks=0;void Check(bool ok,string name){if(!ok)throw new Exception(name);checks++;Console.WriteLine("PASS "+name);}
string goal="Complete the quiz quickly.";
string fact=CodyCommunication.DriveFact(goal,null);
Check(fact.Contains(goal),"The actual requested task is preserved");
Check(!fact.Contains("one short spoken sentence before each group"),"Drive instructions no longer require step-by-step narration");
Check(fact.Contains("omit intermediate say/narration lines entirely"),"Quiet mode omits speech generation rather than only lowering volume");
Check(fact.Contains("do not repeat it"),"Starting computer control does not repeat its acknowledgement");
Check(fact.Contains("observed score")&&fact.Contains("only if the screen actually shows it"),"Final score must come from the verified screen result");
Check(fact.Contains("approval")&&fact.Contains("blocker"),"Necessary approvals and blockers remain allowed");
Check(fact.Contains("explicitly requested live narration"),"An explicit request for explanations can override the quiet default");
Check(CodyCommunication.DriveFact(goal,"Helper").Contains("only this screen step")&&CodyCommunication.DriveFact(goal,"Helper").Contains("output paths"),"Background helper scope and handoff outputs remain intact");
Check(!CodyCommunication.WaitForActionNarration(true),"Cody does not wait 1.6 seconds for narration before each action group");
Check(CodyCommunication.WaitForActionNarration(false),"The original engine mode retains its existing timing");
Console.WriteLine($"{checks} communication checks passed");
