$path = "F:\astock-src\src\lib\collector\collect.ts"
$text = Get-Content $path -Raw
# 给所有 createMany 加 skipDuplicates，保证幂等重跑
$script:count = 0
$text = [regex]::Replace($text, [regex]::Escape('.createMany({ data: batch })'), {
  param($m)
  $script:count++
  '.createMany({ data: batch, skipDuplicates: true })'
})
# dailyMarket 那行是 createMany({ data: marketRows })
$text = $text.Replace('.createMany({ data: marketRows })', '.createMany({ data: marketRows, skipDuplicates: true })')
Set-Content -Path $path -Value $text -Encoding UTF8 -NoNewline
"替换了 $script:count 处 batch createMany + marketRows"
"=== 确认 ==="
Select-String -Path $path -Pattern "createMany" | ForEach-Object { "$($_.LineNumber): $($_.Line.Trim())" }
