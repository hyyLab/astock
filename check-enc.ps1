$bytes = [System.IO.File]::ReadAllBytes("F:\astock-src\src\lib\collector\collect.ts")
$text = [System.Text.Encoding]::UTF8.GetString($bytes)
$idx = $text.IndexOf("backfillDays")
$seg = $text.Substring($idx, 220)
$seg = $seg -replace "`r", "<CR>" -replace "`n", "<LF>"
Write-Output "backfillDays 附近:"
Write-Output $seg
