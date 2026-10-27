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
            $json = @{ voices = $voices } | ConvertTo-Json -Depth 5 -Compress
            [System.IO.File]::WriteAllText([string]$job.resultPath, $json, [System.Text.Encoding]::UTF8)
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
