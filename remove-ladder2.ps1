$path = "F:\astock-src\src\components\lb\ReviewView.tsx"
$bytes = [System.IO.File]::ReadAllBytes($path)
$text = [System.Text.Encoding]::UTF8.GetString($bytes)

# 按行号删 59-63 行（注释 + grid 三行），换成单行 MainThemes
$lines = $text -split "`n", ""
# 保留行尾风格：检查是否 CRLF
$hasCR = $text.Contains("`r`n")

# lines 数组 0-based；要删的是 59-63（1-based）=> index 58..62
$seg = $lines[58..62] -join ""
Write-Output "将删除: $seg"

$newLines = @()
$newLines += $lines[0..57]
$newLines += "      {/* 涓荤嚎棰樻潗 */}"
$newLines += "      <MainThemes bundle={bundle} />"
$newLines += $lines[63..($lines.Count - 1)]

$out = $newLines -join "`n"
if ($hasCR) { $out = $out -replace "`n", "`r`n" }
[System.IO.File]::WriteAllBytes($path, [System.Text.Encoding]::UTF8.GetBytes($out))
Write-Output "done, newlines: $((([System.Text.Encoding]::UTF8.GetBytes($out)) | Where-Object { $_ -eq 10 }).Count)"
