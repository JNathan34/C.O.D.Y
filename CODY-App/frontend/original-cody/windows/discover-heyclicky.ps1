$ErrorActionPreference='Stop'
# Read installation metadata only. Never open profiles, sessions or auth files.
$candidates=New-Object System.Collections.Generic.List[string]
if($env:LOCALAPPDATA){$candidates.Add((Join-Path $env:LOCALAPPDATA 'HeyClickyApp\current'))}
foreach($key in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall')){
  Get-ChildItem $key -ErrorAction SilentlyContinue | ForEach-Object {
    $entry=Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
    if($entry.DisplayName -eq 'HeyClicky' -and $entry.InstallLocation){$candidates.Add((Join-Path $entry.InstallLocation 'current'))}
  }
}
$processes=@(Get-CimInstance Win32_Process -Filter "Name = 'HeyClicky.exe'" -ErrorAction SilentlyContinue)
foreach($process in $processes){if($process.ExecutablePath){$candidates.Insert(0,(Split-Path $process.ExecutablePath))}}
$root=$null
foreach($candidate in $candidates){if(Test-Path -LiteralPath (Join-Path $candidate 'HeyClicky.runtimeconfig.json')){$root=$candidate;break}}
if(!$root){@{detected=$false;running=($processes.Count -gt 0)} | ConvertTo-Json -Compress;exit 0}
$exe=Get-Item -LiteralPath (Join-Path $root 'HeyClicky.exe')
$runtime=Get-Content -LiteralPath (Join-Path $root 'HeyClicky.runtimeconfig.json') -Raw | ConvertFrom-Json
$deps=Get-Content -LiteralPath (Join-Path $root 'HeyClicky.deps.json') -Raw | ConvertFrom-Json
$stream=[IO.File]::OpenRead($exe.FullName)
try{$reader=New-Object IO.BinaryReader($stream);$stream.Position=0x3c;$offset=$reader.ReadInt32();$stream.Position=$offset+4;$machine=$reader.ReadUInt16()}finally{$stream.Dispose()}
$architecture=switch($machine){0x8664{'x64'};0xaa64{'arm64'};0x14c{'x86'};default{'unknown'}}
$modules=@('HeyClicky.Contracts.dll','HeyClicky.Core.dll','HeyClicky.Agents.dll','HeyClicky.Platform.dll','HeyClicky.Drawing.dll','HeyClicky.Drawing3D.dll') | ForEach-Object {
  $file=Join-Path $root $_
  if(Test-Path -LiteralPath $file){$item=Get-Item -LiteralPath $file;@{name=$item.Name;version=$item.VersionInfo.FileVersion}}
}
@{detected=$true;root=$root;version=$exe.VersionInfo.FileVersion;architecture=$architecture;runtime=$runtime.runtimeOptions.tfm;runtimeTarget=$deps.runtimeTarget.name;running=($processes.Count -gt 0);modules=@($modules);browserExtension=(Test-Path -LiteralPath (Join-Path $root 'ClickyBrowserExtension\manifest.json'))} | ConvertTo-Json -Depth 5 -Compress
