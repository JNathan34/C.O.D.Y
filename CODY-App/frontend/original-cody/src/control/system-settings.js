'use strict';
const {commandText}=require('../command-text');

const PAGES=Object.freeze({bluetooth:'bluetooth',wifi:'network-wifi',power:'powersleep',energySaver:'batterysaver',display:'display',sound:'sound',notifications:'notifications',storage:'storagesense',keyboard:'typing',mouse:'mousetouchpad',updates:'windowsupdate',network:'network-status'});
const MODES=Object.freeze({efficiency:'961cc777-2547-4f9d-8174-7d86181b8a7a',balanced:'00000000-0000-0000-0000-000000000000',performance:'ded574b5-45a0-4f42-8737-46345c09c238'});
function parseSystemCommand(input){
 const t=commandText(input,{preserveShow:true}).toLowerCase().replace(/wi[ -]?fi/g,'wifi').replace(/blue tooth/g,'bluetooth');let m;
 const target='(?:the |my )?(bluetooth|wifi)';
 if((m=new RegExp('^(?:turn|switch) (on|off) '+target+'$').exec(t)))return {action:'system.radio.set',args:{kind:m[2],enabled:m[1]==='on'}};
 if((m=new RegExp('^(?:turn|switch) '+target+' (on|off)$').exec(t)))return {action:'system.radio.set',args:{kind:m[1],enabled:m[2]==='on'}};
 if((m=new RegExp('^(enable|disable) '+target+'$').exec(t)))return {action:'system.radio.set',args:{kind:m[2],enabled:m[1]==='enable'}};
 if((m=/^(?:(?:check|show)(?: me)? (?:the |my )?)?(bluetooth|wifi) status$/.exec(t))||(m=/^check (?:the |my )?(bluetooth|wifi)$/.exec(t))||(m=/^is (?:the |my )?(bluetooth|wifi) (?:on|off|enabled|disabled)$/.exec(t)))return {action:'system.radio.status',args:{kind:m[1]}};
 if(/^(?:(?:turn|switch) on (?:the )?power sav(?:er|ing)(?: mode)?|(?:turn|switch) (?:the )?power sav(?:er|ing)(?: mode)? on|enable (?:the )?power sav(?:er|ing)(?: mode)?)$/.test(t))return {action:'system.power.set',args:{mode:'efficiency'}};
 if(/^(?:(?:turn|switch) off (?:the )?power sav(?:er|ing)(?: mode)?|(?:turn|switch) (?:the )?power sav(?:er|ing)(?: mode)? off|disable (?:the )?power sav(?:er|ing)(?: mode)?)$/.test(t))return {action:'system.power.set',args:{mode:'balanced'}};
 if((m=/^(?:set|switch|change)(?: (?:the |my )?power mode)? to (?:the )?(best power efficiency|best efficiency|balanced|best performance|high performance)(?: mode)?$/.exec(t))||(m=/^(?:use|enable) (best power efficiency|best efficiency|balanced|best performance|high performance)(?: mode)?$/.exec(t)))return {action:'system.power.set',args:{mode:/efficiency/.test(m[1])?'efficiency':m[1]==='balanced'?'balanced':'performance'}};
 if(/^(?:(?:check|show)(?: me)? (?:the |my )?)?power mode(?: status)?$/.test(t))return {action:'system.power.status',args:{}};
 if((m=/^(?:set |change )?(?:(?:the|my) )?(?:(?:screen|display) )?brightness (?:to )?(100|[1-9]?\d)(?:\s*%| percent)?$/.exec(t)))return {action:'system.brightness.set',args:{level:Number(m[1])}};
 if(/^(?:(?:check|show)(?: me)? (?:the |my )?)?(?:screen |display )?brightness(?: level)?$/.test(t))return {action:'system.brightness.status',args:{}};
 if((m=/^(?:open|show)(?: me)? (?:the |my )?(bluetooth|wifi|power|energy saver|battery saver|display|sound|notifications|storage|keyboard|mouse|windows update|network) settings$/.exec(t)))return {action:'system.settings.open',args:{page:({'energy saver':'energySaver','battery saver':'energySaver','windows update':'updates'})[m[1]]||m[1]}};
 // Windows' Energy/Battery saver toggle is separate from its performance mode.
 if(/^(?:(?:turn|switch) (?:on|off) (?:the )?(?:battery|energy) saver|(?:turn|switch) (?:the )?(?:battery|energy) saver (?:on|off)|(?:enable|disable) (?:the )?(?:battery|energy) saver)$/.test(t))return {action:'system.settings.open',args:{page:'energySaver'}};
 return null;
}
function validateSystemArgs(action,args){
 const keys=Object.keys(args).sort().join(',');
 switch(action){
 case 'system.radio.set':if(keys!=='enabled,kind'||!['bluetooth','wifi'].includes(args.kind)||typeof args.enabled!=='boolean')break;return {kind:args.kind,enabled:args.enabled};
 case 'system.radio.status':if(keys!=='kind'||!['bluetooth','wifi'].includes(args.kind))break;return {kind:args.kind};
 case 'system.power.set':if(keys!=='mode'||!Object.hasOwn(MODES,args.mode))break;return {mode:args.mode};
 case 'system.brightness.set':if(keys!=='level'||!Number.isInteger(args.level)||args.level<0||args.level>100)break;return {level:args.level};
 case 'system.power.status':case 'system.brightness.status':if(keys!=='')break;return {};
 case 'system.settings.open':if(keys!=='page'||!Object.hasOwn(PAGES,args.page))break;return {page:args.page};
 }
 throw Error('Invalid Windows settings arguments');
}
const RADIO_INIT=String.raw`
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Devices.Radios.Radio,Windows.System.Devices,ContentType=WindowsRuntime]
$null = [Windows.Devices.Radios.RadioAccessStatus,Windows.System.Devices,ContentType=WindowsRuntime]
$null = [Windows.Devices.Radios.RadioState,Windows.System.Devices,ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation?1' } | Select-Object -First 1
function Await-Radio($operation, [Type]$resultType) {
  $task = $asTask.MakeGenericMethod($resultType).Invoke($null,@($operation))
  if (-not $task.Wait(6000)) { throw 'Windows radio operation timed out. Check Bluetooth or Wi-Fi in Windows Settings.' }
  $task.GetAwaiter().GetResult()
}
$all = @(Await-Radio ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]]))
`;
const POWER_INIT=String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CodyPowerMode {
 [StructLayout(LayoutKind.Sequential)] public struct Status { public byte ACLineStatus, BatteryFlag, BatteryLifePercent, SystemStatusFlag; public uint BatteryLifeTime, BatteryFullLifeTime; }
 [DllImport("kernel32.dll")] public static extern bool GetSystemPowerStatus(out Status status);
 [DllImport("powrprof.dll")] public static extern uint PowerGetUserConfiguredACPowerMode(out Guid mode);
 [DllImport("powrprof.dll")] public static extern uint PowerGetUserConfiguredDCPowerMode(out Guid mode);
 [DllImport("powrprof.dll")] public static extern uint PowerSetUserConfiguredACPowerMode(ref Guid mode);
 [DllImport("powrprof.dll")] public static extern uint PowerSetUserConfiguredDCPowerMode(ref Guid mode);
}
'@
$status = New-Object CodyPowerMode+Status
if (-not [CodyPowerMode]::GetSystemPowerStatus([ref]$status) -or $status.ACLineStatus -eq 255) { throw 'Windows power supply state is unavailable.' }
$onBattery = $status.ACLineStatus -eq 0
function Read-PowerMode { $mode = [Guid]::Empty; $code = if ($onBattery) { [CodyPowerMode]::PowerGetUserConfiguredDCPowerMode([ref]$mode) } else { [CodyPowerMode]::PowerGetUserConfiguredACPowerMode([ref]$mode) }; if ($code -ne 0) { throw "Windows could not read the power mode (error $code). Open Power settings." }; $mode.ToString() }
function Power-Label($id) { switch ($id) { '961cc777-2547-4f9d-8174-7d86181b8a7a' { 'Best power efficiency' } '00000000-0000-0000-0000-000000000000' { 'Balanced' } 'ded574b5-45a0-4f42-8737-46345c09c238' { 'Best performance' } default { 'Unknown power mode' } } }
`;
function systemScript(action,input){
 const args=validateSystemArgs(action,input);
 if(action==='system.settings.open')return `Start-Process 'ms-settings:${PAGES[args.page]}'; @{message='${args.page==='energySaver'?'Opened Energy saver settings. Use the Windows control to turn it on or off; no saver toggle has been changed.':'Opened Windows settings.'}';opened=$true} | ConvertTo-Json -Compress`;
 if(action.startsWith('system.radio.')){
  const kind=args.kind==='bluetooth'?'Bluetooth':'WiFi',label=args.kind==='bluetooth'?'Bluetooth':'Wi-Fi',state=args.enabled?'On':'Off';
  return RADIO_INIT+`
$radios = @($all | Where-Object { $_.Kind.ToString() -eq '${kind}' })
if (-not $radios.Count) { throw 'No supported ${label} radio was found. Check its adapter and Windows settings.' }
`+(action.endsWith('.set')?`
$pending = @($radios | Where-Object { $_.State.ToString() -ne '${state}' })
if ($pending.Count) {
 $access = Await-Radio ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus])
 if ($access.ToString() -ne 'Allowed') { throw "Windows denied ${label} control ($access). Use Windows Settings or check device policy." }
 foreach ($radio in $pending) {
  $result = Await-Radio ($radio.SetStateAsync([Windows.Devices.Radios.RadioState]::${state})) ([Windows.Devices.Radios.RadioAccessStatus])
  if ($result.ToString() -ne 'Allowed') { throw "Windows could not change ${label} ($result). Some adapters may have changed; check Windows Settings." }
 }
 for ($i=0; $i -lt 20 -and @($radios | Where-Object { $_.State.ToString() -ne '${state}' }).Count; $i++) { Start-Sleep -Milliseconds 100 }
 if (@($radios | Where-Object { $_.State.ToString() -ne '${state}' }).Count) { throw 'Windows did not confirm ${label} ${state.toLowerCase()}. Check Windows Settings.' }
}
@{message='${label} is ${state.toLowerCase()}.';kind='${args.kind}';enabled=$${args.enabled};radios=@($radios | ForEach-Object { @{name=$_.Name;state=$_.State.ToString()} })} | ConvertTo-Json -Depth 4 -Compress
`:`
$states = @($radios | ForEach-Object { $_.State.ToString().ToLowerInvariant() } | Select-Object -Unique)
@{message=('${label}: '+($states -join ', ')+'.');kind='${args.kind}';radios=@($radios | ForEach-Object { @{name=$_.Name;state=$_.State.ToString()} })} | ConvertTo-Json -Depth 4 -Compress
`);
 }
 if(action.startsWith('system.power.'))return POWER_INIT+(action.endsWith('.set')?`
$target = [Guid]'${MODES[args.mode]}'
$code = if ($onBattery) { [CodyPowerMode]::PowerSetUserConfiguredDCPowerMode([ref]$target) } else { [CodyPowerMode]::PowerSetUserConfiguredACPowerMode([ref]$target) }
if ($code -ne 0) { throw "Windows could not set the power mode (error $code). Open Power settings; the current plan or device policy may prevent this change." }
$actual = Read-PowerMode
if ($actual -ne $target.ToString()) { throw 'Windows did not confirm the requested power mode.' }
@{message=('Power mode set to '+(Power-Label $actual)+$(if ($onBattery) { ' on battery.' } else { ' while plugged in.' }));mode=$actual;onBattery=$onBattery} | ConvertTo-Json -Compress
`:`
$actual = Read-PowerMode
@{message=('Power mode: '+(Power-Label $actual)+$(if ($onBattery) { ' on battery.' } else { ' while plugged in.' }));mode=$actual;onBattery=$onBattery} | ConvertTo-Json -Compress
`);
 return String.raw`
try { $monitors = @(Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightness -ErrorAction Stop | Where-Object { $_.Active }) } catch { throw 'This display does not expose Windows brightness controls. External monitors may need their own controls.' }
if (-not $monitors.Count) { throw 'This display does not expose Windows brightness controls. External monitors may need their own controls.' }
`+(action.endsWith('.set')?`
foreach ($monitor in $monitors) {
 $method = Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightnessMethods | Where-Object { $_.InstanceName -eq $monitor.InstanceName }
 if (-not $method) { throw 'Windows brightness adjustment is unavailable for this display.' }
 $result = Invoke-CimMethod -InputObject $method -MethodName WmiSetBrightness -Arguments @{Timeout=[uint32]0;Brightness=[byte]${args.level}}
 if ($result.ReturnValue -ne 0) { throw 'Windows could not change display brightness.' }
}
$monitors = @(Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightness | Where-Object { $_.Active })
if (-not $monitors.Count -or @($monitors | Where-Object { $_.CurrentBrightness -ne ${args.level} }).Count) { throw 'Windows did not confirm the requested brightness. Check Display settings.' }
@{message='Brightness set to ${args.level}%.';level=${args.level}} | ConvertTo-Json -Compress
`:`
@{message=('Brightness: '+(($monitors | ForEach-Object { [string]$_.CurrentBrightness+'%' }) -join ', ')+'.');levels=@($monitors | ForEach-Object { $_.CurrentBrightness })} | ConvertTo-Json -Compress
`);
}
function buildSystemScript(action,args){
 return "$ProgressPreference='SilentlyContinue'\ntry {\n"+systemScript(action,args)+"\n} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }";
}
module.exports={parseSystemCommand,validateSystemArgs,buildSystemScript,PAGES};
