param([string]$OutputDirectory=(Join-Path $PSScriptRoot '../frontend/original-cody/src/island/renderer/assets/task-apps'))
$ErrorActionPreference='Stop'
$taskOutput=[IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $taskOutput | Out-Null
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class CodyVendorIconExport {
 [DllImport("shell32.dll",CharSet=CharSet.Unicode)] public static extern int SHDefExtractIcon(string file,int index,uint flags,out IntPtr large,out IntPtr small,uint size);
 [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr icon);
}
"@
$taskSources=[ordered]@{}
function Export-TaskIcon([string]$Name,[string]$File){
 if(!(Test-Path -LiteralPath $File)){throw "Missing installed app icon: $Name"}
 $taskLarge=[IntPtr]::Zero;$taskSmall=[IntPtr]::Zero
 try{
  $taskResult=[CodyVendorIconExport]::SHDefExtractIcon($File,0,0,[ref]$taskLarge,[ref]$taskSmall,256)
  if($taskResult -lt 0 -or $taskLarge -eq [IntPtr]::Zero){throw "Cannot extract installed app icon: $Name"}
  $taskIcon=[System.Drawing.Icon]::FromHandle($taskLarge)
  $taskBitmap=$taskIcon.ToBitmap()
  try{$taskBitmap.Save((Join-Path $taskOutput "$Name.png"),[System.Drawing.Imaging.ImageFormat]::Png)}finally{$taskBitmap.Dispose();$taskIcon.Dispose()}
  $taskSources[$Name]=[ordered]@{source='Installed application icon resource';application=[IO.Path]::GetFileName($File);version=[Diagnostics.FileVersionInfo]::GetVersionInfo($File).FileVersion}
 }finally{if($taskLarge -ne [IntPtr]::Zero){[void][CodyVendorIconExport]::DestroyIcon($taskLarge)};if($taskSmall -ne [IntPtr]::Zero){[void][CodyVendorIconExport]::DestroyIcon($taskSmall)}}
}
$taskOffice='C:/Program Files/Microsoft Office/root/Office16'
Export-TaskIcon word (Join-Path $taskOffice 'WINWORD.EXE')
Export-TaskIcon excel (Join-Path $taskOffice 'EXCEL.EXE')
Export-TaskIcon powerpoint (Join-Path $taskOffice 'POWERPNT.EXE')
Export-TaskIcon mail (Join-Path $taskOffice 'OUTLOOK.EXE')
$taskDiscord=Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'Discord') -Directory -Filter 'app-*' | Sort-Object { [version]$_.Name.Substring(4) } -Descending | Select-Object -First 1
Export-TaskIcon discord (Join-Path $taskDiscord.FullName 'Discord.exe')
foreach($taskApp in @(@{id='whatsapp';package='WhatsApp';asset='AppList.targetsize-256_altform-unplated.png'},@{id='spotify';package='Spotify';asset='Square44x44Logo.targetsize-256_altform-unplated.png'})){
 $taskPackage=Get-AppxPackage | Where-Object Name -Match $taskApp.package | Select-Object -First 1
 $taskSource=Join-Path $taskPackage.InstallLocation (Join-Path 'Assets' $taskApp.asset)
 Copy-Item -LiteralPath $taskSource -Destination (Join-Path $taskOutput ($taskApp.id+'.png'))
 $taskSources[$taskApp.id]=[ordered]@{source='Original installed application package asset';application=$taskPackage.Name;version=$taskPackage.Version.ToString();asset=$taskApp.asset}
}
$taskSources | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $taskOutput 'SOURCE.json')
Get-ChildItem -LiteralPath $taskOutput -Filter '*.png' | ForEach-Object {$taskImage=[System.Drawing.Image]::FromFile($_.FullName);try{[pscustomobject]@{icon=$_.Name;width=$taskImage.Width;height=$taskImage.Height}}finally{$taskImage.Dispose()}}
