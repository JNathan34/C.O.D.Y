param([ValidateSet('arm64','x64')][string]$Architecture = 'arm64', [string]$RuntimeDirectory, [string]$BundledRuntimeDirectory)
$ErrorActionPreference = 'Stop'
$env:PSModulePath = Join-Path $PSHOME 'Modules'
$runtime = if ($RuntimeDirectory) { [IO.Path]::GetFullPath($RuntimeDirectory) } else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\runtime\speech')) }
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$bundled = if ($BundledRuntimeDirectory) { [IO.Path]::GetFullPath($BundledRuntimeDirectory) } else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\runtime\speech')) }

function Test-VerifiedFile([string]$File, [string]$Hash, [long]$Bytes = 0) {
    if (!(Test-Path -LiteralPath $File -PathType Leaf)) { return $false }
    if ($Bytes -gt 0 -and (Get-Item -LiteralPath $File).Length -ne $Bytes) { return $false }
    return (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash -eq $Hash
}

function Ensure-VerifiedFile([string]$Target, [string]$Source, [string]$Url, [string]$Hash, [long]$Bytes = 0) {
    if (Test-VerifiedFile $Target $Hash $Bytes) { return }
    # Only fully verified files get the active filename. Interrupted downloads
    # remain .partial files and cannot shadow a working bundled model.
    $staged = $Target + '.partial-' + [guid]::NewGuid().ToString('N')
    if (Test-VerifiedFile $Source $Hash $Bytes) {
        Write-Output ('Using verified bundled file: ' + [IO.Path]::GetFileName($Target))
        Copy-Item -LiteralPath $Source -Destination $staged
    } else {
        Write-Output ('Downloading: ' + [IO.Path]::GetFileName($Target))
        Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $staged
    }
    if (!(Test-VerifiedFile $staged $Hash $Bytes)) { throw 'Downloaded speech file is incomplete or damaged. The active file was not replaced. Run Install recognition again.' }
    if (Test-Path -LiteralPath $Target) {
        $preserved = $Target + '.invalid-' + [guid]::NewGuid().ToString('N')
        Move-Item -LiteralPath $Target -Destination $preserved
        Write-Output ('Preserved damaged file: ' + $preserved)
    }
    Move-Item -LiteralPath $staged -Destination $Target
}
$binary = if ($Architecture -eq 'arm64') { 'whisper-bin-win-cpu-arm64.zip' } else { 'whisper-bin-x64.zip' }
$binaryHash = if ($Architecture -eq 'arm64') { '28c37e7b598c3d9bbfef94f3bd67f2ee6f12b7c86f3da5edcf5e4308d615ff6d' } else { '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb' }
$archive = Join-Path $runtime ('whisper-' + $Architecture + '.zip')
$destination = Join-Path $runtime $Architecture
if (!(Test-Path -LiteralPath (Join-Path $destination 'Release\whisper-cli.exe'))) {
    $bundledRelease = Join-Path $bundled ($Architecture + '\Release')
    if(Test-Path -LiteralPath (Join-Path $bundledRelease 'whisper-cli.exe')){
        $release = Join-Path $destination 'Release'
        New-Item -ItemType Directory -Path $release -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $bundledRelease 'whisper-cli.exe') -Destination $release
        Get-ChildItem -LiteralPath $bundledRelease -Filter '*.dll' -File | Copy-Item -Destination $release
    }else{
        Ensure-VerifiedFile $archive (Join-Path $bundled ('whisper-' + $Architecture + '.zip')) ('https://github.com/ggml-org/whisper.cpp/releases/download/b5454/' + $binary) $binaryHash
        Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force
    }
}
$model = Join-Path $runtime 'ggml-small.en-q5_1.bin'
Ensure-VerifiedFile $model (Join-Path $bundled 'ggml-small.en-q5_1.bin') 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small.en-q5_1.bin' 'bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30' 190098681
Write-Output 'Local Whisper speech recognition is ready.'
