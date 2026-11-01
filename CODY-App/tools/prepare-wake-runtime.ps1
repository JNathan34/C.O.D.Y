$ErrorActionPreference = 'Stop'
$reworkRoot = Split-Path $PSScriptRoot -Parent
$packages = Join-Path $reworkRoot 'work\wake-dotnet'
New-Item -ItemType Directory -Path $packages -Force | Out-Null
function Get-WakeAsset($url, $destination, $sha256) {
    if (!(Test-Path -LiteralPath $destination)) { Invoke-WebRequest -Uri $url -OutFile $destination }
    if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $sha256) { throw "Wake asset checksum mismatch: $destination" }
}
Get-WakeAsset 'https://api.nuget.org/v3-flatcontainer/org.k2fsa.sherpa.onnx/1.13.5/org.k2fsa.sherpa.onnx.1.13.5.nupkg' (Join-Path $packages 'managed.zip') 'E254E6B92316AE5162A34EE9AEF48B49A7ED6312F0BCE0730B27A8CAD1EF8A5E'
Get-WakeAsset 'https://api.nuget.org/v3-flatcontainer/org.k2fsa.sherpa.onnx.runtime.win-x64/1.13.5/org.k2fsa.sherpa.onnx.runtime.win-x64.1.13.5.nupkg' (Join-Path $packages 'runtime.zip') 'EAB958CF8D369F2EB8499B237FDC590BF2ED62338213AF032DED1B44E02066E7'
Expand-Archive -LiteralPath (Join-Path $packages 'managed.zip') -DestinationPath (Join-Path $packages 'managed') -Force
Expand-Archive -LiteralPath (Join-Path $packages 'runtime.zip') -DestinationPath (Join-Path $packages 'runtime') -Force
$archive = Join-Path $reworkRoot 'work\wake-kws-model.tar.bz2'
Get-WakeAsset 'https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20.tar.bz2' $archive '68447F4FBC67E70EEE3A93961F36E81E98F47AEF73CE7E7CA00885C6CD3616A6'
tar -xf $archive -C (Join-Path $reworkRoot 'work')
if ($LASTEXITCODE -ne 0) { throw 'Could not extract the wake model.' }
$model = Join-Path $reworkRoot 'work\sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20'
$destination = Join-Path $reworkRoot 'work\Cody.Engine\BundledResources\wake'
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $model 'encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx') -Destination (Join-Path $destination 'encoder.onnx') -Force
Copy-Item -LiteralPath (Join-Path $model 'decoder-epoch-13-avg-2-chunk-16-left-64.onnx') -Destination (Join-Path $destination 'decoder.onnx') -Force
Copy-Item -LiteralPath (Join-Path $model 'joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx') -Destination (Join-Path $destination 'joiner.onnx') -Force
Copy-Item -LiteralPath (Join-Path $model 'tokens.txt') -Destination (Join-Path $destination 'tokens.txt') -Force
Write-Host 'Pinned local wake detector runtime and model are ready.'

Get-WakeAsset 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx' (Join-Path $destination 'silero-vad.onnx') '9E2449E1087496D8D4CABA907F23E0BD3F78D91FA552479BB9C23AC09CBB1FD6'
