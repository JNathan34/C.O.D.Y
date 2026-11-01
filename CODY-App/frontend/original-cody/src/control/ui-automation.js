'use strict';
// Windows UI Automation: read only names/roles of controls, with a bounded depth.
// Native physical bounds are observations; annotation targets convert them to DIP.
const {psQuote}=require('./windows');
const imports=String.raw`Add-Type -AssemblyName UIAutomationClient;Add-Type -AssemblyName UIAutomationTypes;`;
const openWin=(pid)=>{
 const constraint=pid?`$candidate=[System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty,${pid}));`:
 `$candidate=[System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition);`;
 return constraint;
};
function inspect(pid){return `${imports} ${openWin(pid)}
$out=@(); foreach($w in $candidate){if($out.Count -ge 12){break};try{
 if($w.Current.ProcessId -eq ${process.pid} -and $w.Current.Name -in @('C.O.D.Y screen annotations','C.O.D.Y 3D scene')){continue}
 $controls=@(); $nodes=$w.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition);
 for($i=0;$i -lt [Math]::Min($nodes.Count,90);$i++){
 $n=$nodes.Item($i);$name=$n.Current.Name;$role=$n.Current.ControlType.ProgrammaticName;
 if($n.Current.IsOffscreen){continue}
 if($name -or $role -match '(Button|Edit|MenuItem|CheckBox|ComboBox)'){
 $bounds=$n.Current.BoundingRectangle;if($bounds.IsEmpty -or $bounds.Width -le 0 -or $bounds.Height -le 0 -or @($bounds.X,$bounds.Y,$bounds.Width,$bounds.Height | Where-Object {[double]::IsInfinity($_) -or [double]::IsNaN($_)}).Count -gt 0){continue};$controls+=@{name=$name;role=$role;automationId=$n.Current.AutomationId;enabled=$n.Current.IsEnabled;bounds=@{x=$bounds.X;y=$bounds.Y;width=$bounds.Width;height=$bounds.Height}};
 }
 }
 $wb=$w.Current.BoundingRectangle;if($wb.IsEmpty -or $wb.Width -le 0 -or $wb.Height -le 0 -or @($wb.X,$wb.Y,$wb.Width,$wb.Height | Where-Object {[double]::IsInfinity($_) -or [double]::IsNaN($_)}).Count -gt 0){continue};$out+=@{pid=$w.Current.ProcessId;title=$w.Current.Name;bounds=@{x=$wb.X;y=$wb.Y;width=$wb.Width;height=$wb.Height};controls=$controls};
 }catch{}}
ConvertTo-Json -InputObject @($out) -Compress -Depth 7`;
}
function click(pid,name){if(!Number.isInteger(pid)||pid<1)throw Error('Invalid PID');if(typeof name!=='string'||name.length>120||!name.trim())throw Error('Invalid element name');const encoded=psQuote(name);return `${imports} ${openWin(pid)}
$matches=@();foreach($w in $candidate){$els=$w.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,${encoded}));for($i=0;$i -lt $els.Count;$i++){$matches+=,$els.Item($i)}}
if($matches.Count -ne 1){throw "Expected exactly one element; found $($matches.Count)"}
$element=$matches[0];if(-not $element.Current.IsEnabled){throw 'UI element is disabled'}
$pattern=$null;if(-not $element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)){throw 'Element does not support InvokePattern'}
$pattern.Invoke();'Invoked accessible control'`;
}
module.exports={inspect,click};
