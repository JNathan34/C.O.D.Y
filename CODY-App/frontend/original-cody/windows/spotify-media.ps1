param([switch]$Once)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'media-selection.ps1')
. (Join-Path $PSScriptRoot 'media-artwork.ps1')
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$managerType=[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
$propertiesType=[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime]
$asTask=([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'} | Select-Object -First 1)
function Await($operation,$type){$task=$asTask.MakeGenericMethod($type).Invoke($null,@($operation));if(-not $task.Wait(5000)){throw 'Windows media request timed out'};return $task.Result}
function Send($data){[Console]::Out.WriteLine(($data | ConvertTo-Json -Compress -Depth 5));[Console]::Out.Flush()}
# Console.In.ReadLineAsync blocks synchronously in Windows PowerShell/.NET Framework.
# Read commands on a background CLR thread so an open pipe never stops media polling.
Add-Type -TypeDefinition @'
using System;
using System.Threading;
using System.Collections.Concurrent;
public static class CodyMediaInput {
  public static readonly ConcurrentQueue<string> Lines = new ConcurrentQueue<string>();
  public static readonly AutoResetEvent Ready = new AutoResetEvent(false);
  public static volatile bool Closed;
  public static void Start() {
    var reader = new Thread(() => {
      try {
        string line;
        while ((line = Console.ReadLine()) != null) {
          Lines.Enqueue(line);
          Ready.Set();
        }
      }
      catch { }
      finally { Closed = true; Ready.Set(); }
    });
    reader.IsBackground = true;
    reader.Start();
  }
}
'@
try {
  $manager=Await ($managerType::RequestAsync()) $managerType
  if(-not $Once){[CodyMediaInput]::Start()}
  $previous='';$nextPoll=[DateTime]::MinValue;$artKey='';$artwork=$null;$artService='';$artRetry=[DateTime]::MinValue;$appIcons=@{}
  do {
    $line=$null;$hasCommand=[CodyMediaInput]::Lines.TryDequeue([ref]$line)
    $request=if($hasCommand){$line | ConvertFrom-Json}
    $pollDue=-not $hasCommand -and [DateTime]::UtcNow -ge $nextPoll
    $selectCurrent=$pollDue -or ($hasCommand -and $request.action -ne 'refresh' -and $request.target -eq 'current')
    if($pollDue -or ($hasCommand -and $request.action -ne 'refresh')){
      $sessions=@($manager.GetSessions())
      $ownerProcesses=$null
      if($selectCurrent){
        $ownerProcesses=@(Get-Process -ErrorAction SilentlyContinue)
      }else{
        $sessions=@($sessions | Where-Object {
          $source=$_.SourceAppUserModelId
          switch($request.target){
            'active'{$source -eq $request.source}
            'plezy'{$source -match '(?i)plezy'}
            default{$source -match '(?i)spotify'}
          }
        })
      }
      $sessions=@($sessions | Where-Object {try{Test-CodyMediaOwner $_.SourceAppUserModelId ($_.GetPlaybackInfo().PlaybackStatus.ToString()) $ownerProcesses}catch{$false}})
    }
    if($selectCurrent){
      $metadataBySource=@{}
      $eligible={param($candidate)
        try{
          $metadata=Await ($candidate.TryGetMediaPropertiesAsync()) $propertiesType
          $metadataBySource[$candidate.SourceAppUserModelId]=$metadata
          return Test-CodyMediaContent $candidate.SourceAppUserModelId $metadata ($candidate.GetTimelineProperties())
        }catch{return $false}
      }
      $session=Select-CodyMediaSession $sessions ($manager.GetCurrentSession()) $eligible
    }
    if($hasCommand){
      if($line){
        try {
          if($request.action -eq 'refresh'){$previous='';$nextPoll=[DateTime]::MinValue;continue}
          $target=if($request.target -eq 'current'){$session}else{$sessions | Select-Object -First 1}
          if(-not $target){throw 'That media player is no longer available. Open it and start playback first.'}
          if(-not (Test-CodyMediaSource $target.SourceAppUserModelId)){throw 'This audio session is not a media player.'}
          $operation=switch($request.action){'play'{$target.TryPlayAsync()};'pause'{$target.TryPauseAsync()};'toggle'{$target.TryTogglePlayPauseAsync()};'next'{$target.TrySkipNextAsync()};'previous'{$target.TrySkipPreviousAsync()};'seek'{
            $seconds=[double]$request.seconds;if([double]::IsNaN($seconds)-or [double]::IsInfinity($seconds)-or $seconds -eq 0 -or [Math]::Abs($seconds)-gt 86400){throw 'Invalid seek duration'}
            $timeline=$target.GetTimelineProperties();$position=$timeline.Position.Ticks+[long]($seconds*[TimeSpan]::TicksPerSecond);
            $position=[Math]::Max($timeline.StartTime.Ticks,$position);if($timeline.EndTime.Ticks -gt $timeline.StartTime.Ticks){$position=[Math]::Min($timeline.EndTime.Ticks,$position)}
            $target.TryChangePlaybackPositionAsync([long]$position)
          };default{throw 'Unsupported media command'}}
          $ok=Await $operation ([bool]);if(-not $ok){throw 'The media player did not accept that playback command.'};Send @{id=$request.id;ok=$true;source=$target.SourceAppUserModelId};$previous=''
        }catch{Send @{id=$request.id;error=$_.Exception.Message}}
      }
      $nextPoll=[DateTime]::MinValue
      continue
    }
    if($pollDue){
      $state=@{available=$false;title='';artist='';playing=$false;source='';app=''}
      if($session){
        $properties=$metadataBySource[$session.SourceAppUserModelId]
        if(-not $properties){$properties=Await ($session.TryGetMediaPropertiesAsync()) $propertiesType}
        $source=$session.SourceAppUserModelId
        $appName=switch -Regex ($source){'(?i)spotify'{'Spotify';break};'(?i)youtube'{'YouTube';break};'(?i)plezy'{'Plezy';break};'(?i)firefox'{'Firefox';break};'(?i)msedge'{'Edge';break};'(?i)chrome'{'Chrome';break};'(?i)vlc'{'VLC';break};'(?i)zune|mediaplayer'{'Media Player';break};default{'Media'}}
        $title=if($properties.Title){$properties.Title}else{$appName}
        $nextArtKey=$source+'|'+$title+'|'+$properties.Artist
        if($nextArtKey -ne $artKey -or (-not $artwork -and [DateTime]::UtcNow -ge $artRetry)){
          $artKey=$nextArtKey;$artwork=Get-CodyThumbnail $properties.Thumbnail;$artRetry=[DateTime]::UtcNow.AddSeconds(10);$artService=$appName
          if($appName -in @('Firefox','Chrome','Edge')){
            $browserName=switch($appName){'Firefox'{'firefox'};'Chrome'{'chrome'};'Edge'{'msedge'}}
            $youtube=Get-Process -Name $browserName -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowTitle -match 'YouTube' -and $_.MainWindowTitle.IndexOf($title,[StringComparison]::OrdinalIgnoreCase) -ge 0} | Select-Object -First 1
            if($youtube){$artService='YouTube'}
          }
        }
        if(-not $appIcons.ContainsKey($source)){$appIcons[$source]=Get-CodyAppIcon $source}
        $timeline=$session.GetTimelineProperties();$state=@{available=$true;title=$title;artist=$properties.Artist;playing=($session.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing');source=$source;app=$appName;service=$artService;artwork=$artwork;appIcon=$appIcons[$source];positionSeconds=$timeline.Position.TotalSeconds;durationSeconds=($timeline.EndTime-$timeline.StartTime).TotalSeconds}
      }
      $json=$state | ConvertTo-Json -Compress
      if($json -ne $previous){Send @{state=$state};$previous=$json}
      $nextPoll=[DateTime]::UtcNow.AddSeconds(2)
    }
    if(-not $Once -and [CodyMediaInput]::Lines.IsEmpty){
      if([CodyMediaInput]::Closed){break}
      $wait=[Math]::Max(0,($nextPoll-[DateTime]::UtcNow).TotalMilliseconds)
      [void][CodyMediaInput]::Ready.WaitOne([int][Math]::Ceiling($wait))
    }
  }while(-not $Once)
}catch{Send @{state=@{available=$false;error=$_.Exception.Message}};exit 1}
