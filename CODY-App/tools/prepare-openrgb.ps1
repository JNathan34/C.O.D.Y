param([switch]$Package)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$archive = Join-Path $root 'reports\openrgb-portable-1.1.zip'
$runtimeDirectory = if ($Package) { 'build\openrgb' } else { 'run\openrgb' }
$runtime = Join-Path $root $runtimeDirectory
$portable = Join-Path $runtime 'OpenRGB Windows 64-bit'
$expectedHash = '63291726C6FC84EB479EF2EE752E97E1187F6CE9C49FD27EEE40DED588A8172A'
$url = 'https://codeberg.org/OpenRGB/OpenRGB/releases/download/release_1.1/OpenRGB_1.1_Windows_64_8e16de2.zip'

if (!(Test-Path -LiteralPath $archive)) {
  New-Item -ItemType Directory -Path (Split-Path $archive -Parent) -Force | Out-Null
  $download = "$archive.download"
  & curl.exe --fail --location --retry 2 --max-time 180 --output $download $url
  if ($LASTEXITCODE -ne 0) { throw 'Could not download the pinned OpenRGB runtime.' }
  if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ne $expectedHash) {
    throw 'The downloaded OpenRGB archive does not match the pinned release checksum.'
  }
  Move-Item -LiteralPath $download -Destination $archive
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expectedHash) {
  throw 'The cached OpenRGB archive does not match the pinned release checksum.'
}
Expand-Archive -LiteralPath $archive -DestinationPath $runtime -Force
foreach ($name in @('OpenRGB.exe', 'Qt6Core.dll', 'platforms\qwindows.dll')) {
  if (!(Test-Path -LiteralPath (Join-Path $portable $name))) { throw "Missing OpenRGB runtime file $name" }
}
Copy-Item -LiteralPath (Join-Path $root 'docs\OPENRGB-LICENSE.txt') -Destination (Join-Path $portable 'COPYING.txt') -Force
Copy-Item -LiteralPath (Join-Path $root 'docs\GPL-3.0.txt') -Destination $portable -Force
Copy-Item -LiteralPath (Join-Path $root 'docs\QT-LGPL-3.0.txt') -Destination $portable -Force
Copy-Item -LiteralPath (Join-Path $root 'docs\OPENRGB.md') -Destination (Join-Path $portable 'THIRD-PARTY.md') -Force
Write-Host 'Prepared OpenRGB 1.1 for the C.O.D.Y. installer.'
