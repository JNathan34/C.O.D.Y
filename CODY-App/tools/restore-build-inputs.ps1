param([string]$Archive)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'build-inputs.json') -Raw | ConvertFrom-Json
if (!$Archive) {
  $downloadDirectory = Join-Path $projectRoot '.cache\build-inputs'
  New-Item -ItemType Directory -Path $downloadDirectory -Force | Out-Null
  $Archive = Join-Path $downloadDirectory $manifest.name
  if (!(Test-Path -LiteralPath $Archive)) { Invoke-WebRequest -Uri $manifest.url -OutFile $Archive }
}
$Archive = (Resolve-Path -LiteralPath $Archive).Path
if ((Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLower() -ne $manifest.sha256) { throw 'Build input checksum mismatch. The archive was not extracted.' }
$target = [IO.Path]::GetFullPath($projectRoot)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($Archive)
try {
  foreach ($entry in $zip.Entries) {
    $entryPath = [IO.Path]::GetFullPath((Join-Path $target $entry.FullName))
    if (!$entryPath.StartsWith($target + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe archive path.' }
    if ($entry.FullName -notmatch '^(pristine/windows-1\.1\.3/|build/installer/)') { throw 'Unexpected build input path.' }
    if (!$entry.Name) { New-Item -ItemType Directory -Path $entryPath -Force | Out-Null; continue }
    New-Item -ItemType Directory -Path (Split-Path $entryPath -Parent) -Force | Out-Null
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $entryPath, $true)
  }
} finally { $zip.Dispose() }
Write-Host 'Verified and restored native runtime and installer prerequisites. Run Build-Engine.bat next.'
