# Print memory of all browser processes whose command line contains $Marker, every ~200 ms.
# Output CSV: unix_ms, total_private_bytes, max_page_process_private_bytes, total_working_set
# "Page process" = Chromium renderer (--type=renderer) or Firefox content process (-contentproc).
param([string]$Marker, [string]$Name = "msedge.exe")
while ($true) {
  $all = @(Get-CimInstance Win32_Process -Filter "Name='$Name'")
  $ids = @{}
  $all | Where-Object { $_.CommandLine -like "*$Marker*" } | ForEach-Object { $ids[$_.ProcessId] = $true }
  # Also include child processes (Firefox children don't carry the profile path)
  do {
    $added = $false
    foreach ($x in $all) { if (-not $ids[$x.ProcessId] -and $ids[$x.ParentProcessId]) { $ids[$x.ProcessId] = $true; $added = $true } }
  } while ($added)
  $p = $all | Where-Object { $ids[$_.ProcessId] }
  $r = $p | Where-Object { $_.CommandLine -like '*--type=renderer*' -or $_.CommandLine -like '*-contentproc*' }
  $tot = ($p | Measure-Object PrivatePageCount -Sum).Sum
  $ren = ($r | Measure-Object PrivatePageCount -Maximum).Maximum
  $ws = ($p | Measure-Object WorkingSetSize -Sum).Sum
  "{0},{1},{2},{3}" -f [DateTimeOffset]::Now.ToUnixTimeMilliseconds(), $tot, $ren, $ws
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 150
}
