$path = "F:\astock-src\src\lib\collector\collect.ts"
# 用字节级读写避免编码问题
$bytes = [System.IO.File]::ReadAllBytes($path)
$text = [System.Text.Encoding]::UTF8.GetString($bytes)
$before = ([regex]::Matches($text, [regex]::Escape('.createMany({ data: batch })'))).Count
$text = $text.Replace('.createMany({ data: batch })', '.createMany({ data: batch, skipDuplicates: true })')
$text = $text.Replace('.createMany({ data: marketRows })', '.createMany({ data: marketRows, skipDuplicates: true })')
[System.IO.File]::WriteAllBytes($path, [System.Text.Encoding]::UTF8.GetBytes($text))
Write-Output "替换 $before 处 batch + marketRows"
Write-Output "换行符保留检查: $((([System.Text.Encoding]::UTF8.GetBytes($text)) | Where-Object { $_ -eq 10 }).Count) 个 0A"
