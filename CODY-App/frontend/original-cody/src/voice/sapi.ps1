param(
  [Parameter(Mandatory=$true)][string]$Action,
  [Parameter(Mandatory=$true)][string]$InputPath
)
$ErrorActionPreference = "Stop"
try {
    Add-Type -AssemblyName System.Speech
    $job = Get-Content -LiteralPath $InputPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
    try {
        if ($Action -eq 'voices') {
            $voices = @(
                $synth.GetInstalledVoices() | ForEach-Object {
                    [pscustomobject]@{
                        id = $_.VoiceInfo.Name
                        name = $_.VoiceInfo.Name
                        language = $_.VoiceInfo.Culture.Name
                    }
                }
            )
            # Windows Narrator natural voices are packaged separately from SAPI/WinRT.
            # These entries are diagnostic only; do not claim they are playable.
            $narratorVoices = @()
            try {
                $packages = @(Get-AppxPackage -ErrorAction SilentlyContinue | Where-Object {
                    $_.Name -match '(?i)MicrosoftWindows[.]Voice[.]'
                })
                foreach ($pkg in $packages) {
                    if ([string]$pkg.Name -match '(?i)Voice[.]([a-z]{2}-[a-z]{2})[.]([a-z][a-z0-9]*)(?:[.]|$)') {
                        $culture = $Matches[1]
                        $who = $Matches[2]
                        $description = 'Microsoft ' + $who + ' (Natural)'
                        $narratorVoices += [pscustomobject]@{
                            id = [string]$pkg.Name
                            name = $description
                            language = $culture
                        }
                    }
                }
            } catch { }
            # Some Narrator voices expose metadata in OneCore registry, not SAPI.
            try {
                $tokens = @(Get-ChildItem -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens' -ErrorAction SilentlyContinue)
                foreach ($token in $tokens) {
                    $key = [string]$token.PSChildName
                    if ($key -match '(?i)(Ryan|Andrew|Ava|Sonia|Jenny|Aria).*Natural|Natural.*(Ryan|Andrew|Ava|Sonia|Jenny|Aria)') {
                        $n = if ($Matches[1]) { $Matches[1] } else { $Matches[2] }
                        if (-not @($narratorVoices | Where-Object { $_.name -match $n }).Count) {
                            $narratorVoices += [pscustomobject]@{
                                id = $key
                                name = 'Microsoft ' + $n + ' (Natural)'
                                language = ''
                            }
                        }
                    }
                }
            } catch { }
            $json = @{ voices = $voices; narratorVoices = $narratorVoices } | ConvertTo-Json -Depth 6 -Compress
            [System.IO.File]::WriteAllText([string]$job.resultPath, $json, [System.Text.UTF8Encoding]::new($false))
        } elseif ($Action -eq 'speak') {
            if (![string]::IsNullOrWhiteSpace([string]$job.voice)) {
                $synth.SelectVoice([string]$job.voice)
            }
            $synth.Rate = [Math]::Max(-10,[Math]::Min(10,[int][Math]::Round(([double]$job.speed - 1) * 10)))
            $synth.Volume = 100
            $synth.SetOutputToWaveFile([string]$job.audioPath)
            $synth.Speak([string]$job.text)
            $synth.SetOutputToNull()
        } else {
            throw "Unknown SAPI action"
        }
    } finally {
        $synth.Dispose()
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
