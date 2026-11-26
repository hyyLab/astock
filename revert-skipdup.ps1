// 撤销 skipDuplicates，改为入库前去重
$bytes = [System.IO.File]::ReadAllBytes("F:\astock-src\src\lib\collector\collect.ts")
$text = [System.Text.Encoding]::UTF8.GetString($bytes)
$text = $text.Replace(', skipDuplicates: true', '')
[System.IO.File]::WriteAllBytes("F:\astock-src\src\lib\collector\collect.ts", [System.Text.Encoding]::UTF8.GetBytes($text))
Write-Output "skipDuplicates 已撤销: $((([regex]::Matches($text, 'skipDuplicates'))).Count) 处残留"
Write-Output "换行符: $((([System.Text.Encoding]::UTF8.GetBytes($text)) | Where-Object { $_ -eq 10 }).Count) 个"
