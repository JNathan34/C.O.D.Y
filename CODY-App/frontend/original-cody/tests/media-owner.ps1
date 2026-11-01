$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../windows/media-selection.ps1')
function Assert($value,$name){if(-not $value){throw $name}}
$open=@([pscustomobject]@{ProcessName='Spotify';MainWindowHandle=123})
$tray=@([pscustomobject]@{ProcessName='Spotify';MainWindowHandle=0})
Assert (-not (Test-CodyMediaOwner 'Spotify.exe' 'Paused' @())) 'A closed player must not keep a paused card'
Assert (-not (Test-CodyMediaOwner 'SpotifyAB.SpotifyMusic_test!Spotify' 'Playing' @())) 'A dead owner must not keep a stale playing card'
Assert (Test-CodyMediaOwner 'Spotify.exe' 'Paused' $open) 'An open paused player stays visible'
Assert (-not (Test-CodyMediaOwner 'Spotify.exe' 'Paused' $tray)) 'A paused tray-only player is hidden'
Assert (Test-CodyMediaOwner 'Spotify.exe' 'Playing' $tray) 'Music playing in background stays visible'
Assert (-not (Test-CodyMediaOwner 'Spotify.exe' 'Paused' @([pscustomobject]@{ProcessName='plezy';MainWindowHandle=456}))) 'An unrelated player cannot keep Spotify alive'
Assert (Test-CodyMediaOwner 'Plezy' 'Paused' @([pscustomobject]@{ProcessName='plezy';MainWindowHandle=456})) 'Plezy keeps its paused card when open'
Assert (-not (Test-CodyMediaOwner 'firefox.exe' 'Paused' @())) 'Closed browser media is hidden'
Assert (Test-CodyMediaOwner 'UnknownPlayer' 'Paused' @()) 'Unknown media ownership is not guessed'
'9 media owner checks passed'
