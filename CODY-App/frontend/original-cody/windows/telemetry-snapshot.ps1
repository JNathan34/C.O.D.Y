param([string]$Metrics='all')
$ErrorActionPreference='Stop'
$requested=$Metrics -split ','
$needGpu=$requested -contains 'all' -or $requested -contains 'gpu' -or $requested -contains 'gpuTemp'
$needTemps=$needGpu -or $requested -contains 'all' -or $requested -contains 'cpu' -or $requested -contains 'cpuTemp'
$needWifi=$requested -contains 'all' -or @($requested|Where-Object {$_ -in @('wifi','wifiDetails','wifiSpeed')}).Count -gt 0
$out=@{gpu=$null;gpuName=$null;cpuTemp=$null;gpuTemp=$null;wifi=$null}
if($needGpu){
try{
  $gpu=@(Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -OperationTimeoutSec 2 -ErrorAction Stop)
  if($gpu.Count){$engines=@{};foreach($entry in $gpu){$key=$entry.Name -replace '^pid_\d+_','';if(-not $engines.ContainsKey($key)){$engines[$key]=0};$engines[$key]+=[double]$entry.UtilizationPercentage};$out.gpu=[Math]::Min(100,($engines.Values|Measure-Object -Maximum).Maximum)}
}catch{}
if($null -eq $out.gpu){try{
  $samples=(Get-Counter '\GPU Engine(*)\Utilization Percentage' -ErrorAction Stop).CounterSamples;$engines=@{}
  foreach($entry in $samples){$key=$entry.InstanceName -replace '^pid_\d+_','';if(-not $engines.ContainsKey($key)){$engines[$key]=0};$engines[$key]+=[double]$entry.CookedValue}
  if($engines.Count){$out.gpu=[Math]::Round([Math]::Min(100,($engines.Values|Measure-Object -Maximum).Maximum),1)}
}catch{}}
try{$out.gpuName=(Get-CimInstance Win32_VideoController -OperationTimeoutSec 2 -ErrorAction Stop|Select-Object -First 1).Name}catch{}
}
if($needTemps){
foreach($namespace in @('root\LibreHardwareMonitor','root\OpenHardwareMonitor')){
  try{
    $sensors=@(Get-CimInstance -Namespace $namespace -ClassName Sensor -OperationTimeoutSec 1 -ErrorAction Stop|Where-Object SensorType -eq Temperature)
    $cpu=@($sensors|Where-Object {$_.Identifier -match '/cpu/' -or $_.Name -match '^CPU'}|Where-Object {$_.Value -gt 0 -and $_.Value -lt 150})
    $gpu=@($sensors|Where-Object {$_.Identifier -match '/gpu' -or $_.Name -match '^GPU'}|Where-Object {$_.Value -gt 0 -and $_.Value -lt 150})
    if($cpu.Count){$out.cpuTemp=($cpu.Value|Measure-Object -Maximum).Maximum};if($gpu.Count){$out.gpuTemp=($gpu.Value|Measure-Object -Maximum).Maximum}
  }catch{}
}
}
if($needWifi){
try{
  $adapter=[Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()|Where-Object {$_.NetworkInterfaceType -eq 'Wireless80211' -and $_.OperationalStatus -eq 'Up'}|Select-Object -First 1
  if($adapter){
    $stats=$adapter.GetIPv4Statistics();$wifi=@{connected=$true;adapter=$adapter.Description;linkMbps=[Math]::Round($adapter.Speed/1000000,1);received=[double]$stats.BytesReceived;sent=[double]$stats.BytesSent;ssid=$null;signal=$null;receiveMbps=$null;transmitMbps=$null;radio=$null}
    $wlan=(& netsh.exe wlan show interfaces 2>$null)-join "`n"
    foreach($field in @(@('ssid','(?m)^\s*SSID\s*:\s*(.+)$'),@('signal','(?m)^\s*Signal\s*:\s*(\d+)%'),@('receiveMbps','(?m)^\s*Receive rate \(Mbps\)\s*:\s*([\d.]+)'),@('transmitMbps','(?m)^\s*Transmit rate \(Mbps\)\s*:\s*([\d.]+)'),@('radio','(?m)^\s*Radio type\s*:\s*(.+)$'))){if($wlan -match $field[1]){$wifi[$field[0]]=$Matches[1].Trim()}}
    $out.wifi=$wifi
  }else{$out.wifi=@{connected=$false}}
}catch{$out.wifi=@{error='Wi-Fi adapter data is unavailable'}}
}
$out|ConvertTo-Json -Compress -Depth 4
