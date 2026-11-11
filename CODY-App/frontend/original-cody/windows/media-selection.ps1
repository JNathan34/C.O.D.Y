function Test-CodyMediaSource([string]$source){
    if([string]::IsNullOrWhiteSpace($source)){return $false}
    # Speech, alarms and app notification sounds are never an Island media player.
    if($source -match '(?i)uk\.cody\.|(?:^|[\\/.! _-])c[. _-]*o[. _-]*d[. _-]*y(?:$|[\\/.! _-])|^(?:electron(?:\.exe)?|system\s*sounds?|sndvol(?:\.exe)?)$|(?:^|[\\/.! _-])(?:chatgpt|codex|shellexperiencehost|startmenuexperiencehost)(?:$|[\\/.! _-])'){return $false}
    return $true
}
function Test-CodyMediaOwner([string]$Source,[string]$Status,[object[]]$Processes=$null){
    $names=switch -Regex ($Source){
        '(?i)spotify'{@('Spotify');break};'(?i)plezy'{@('plezy');break};'(?i)firefox'{@('firefox');break};'(?i)msedge'{@('msedge');break};'(?i)chrome'{@('chrome');break};'(?i)vlc'{@('vlc');break};'(?i)zune|mediaplayer'{@('Microsoft.Media.Player','Music.UI','Video.UI','wmplayer','MediaPlayer');break};default{@()}
    }
    if(-not $names.Count){return $true}
    if($null -eq $Processes){$Processes=@(Get-Process -Name $names -ErrorAction SilentlyContinue)}
    $owners=@($Processes | Where-Object { $_.ProcessName -in $names })
    if(-not $owners.Count){return $false}
    # Windows may retain a paused session after closing/hiding a player to its
    # tray. Keep background playback, but show paused media only for an open app.
    if($Status -eq 'Playing'){return $true}
    return @($owners | Where-Object { $_.MainWindowHandle -ne 0 }).Count -gt 0
}
function Test-CodyMediaContent([string]$source,$properties,$timeline){
    if(-not (Test-CodyMediaSource $source)){return $false}
    $title=[string]$properties.Title
    if([string]::IsNullOrWhiteSpace($title)){return $false}
    # Established players may have live streams or paused tracks with no timeline.
    if($source -match '(?i)spotify|youtube|plezy|vlc|zunemusic|mediaplayer|foobar|musicbee|aimp|(?:^|[\\/])mpv|itunes|applemusic|tidal|deezer|plex|jellyfin|netflix|potplayer'){return $true}
    if($title -match '(?i)^(?:media|audio|notifications?(?: sound)?|system sounds?|speech|tts|recording(?:\.wav)?|data:.*|blob:.*)$'){return $false}
    if($source -match '(?i)firefox|msedge|chrome|brave|vivaldi|opera'){return $true}
    # Unknown apps need actual music/video metadata, not just an audio session.
    $type=[string]$properties.PlaybackType
    $duration=if($timeline){($timeline.EndTime-$timeline.StartTime).TotalSeconds}else{0}
    return $type -in @('Music','Video') -and ($duration -ge 10 -or -not [string]::IsNullOrWhiteSpace([string]$properties.Artist))
}
# Prefer the active real player; a self/notification session cannot mask it.
function Select-CodyMediaSession($sessions,$current,[scriptblock]$Eligible=$null) {
    $playing=@();$paused=@()
    foreach($candidate in $sessions){
        try{
            if(-not (Test-CodyMediaSource $candidate.SourceAppUserModelId)){continue}
            $status=$candidate.GetPlaybackInfo().PlaybackStatus.ToString()
            if($status -notin @('Playing','Paused')){continue}
            if($status -eq 'Playing'){$playing+=,$candidate}
            elseif($status -eq 'Paused'){$paused+=,$candidate}
        }catch{}
    }
    $currentSource=if($current){$current.SourceAppUserModelId}
    foreach($group in @(@{sessions=$playing},@{sessions=$paused})){
        $preferred=@($group.sessions | Where-Object {$_.SourceAppUserModelId -eq $currentSource})
        $others=@($group.sessions | Where-Object {$_.SourceAppUserModelId -ne $currentSource})
        foreach($candidate in ($preferred+$others)){
            try{
                if(-not $Eligible -or (& $Eligible $candidate)){return $candidate}
            }catch{}
        }
    }
    return $null
}
