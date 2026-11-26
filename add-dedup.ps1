// 在 limitUpRows 等入库前加去重：按唯一键 tradeDate+stockCode 去重
$bytes = [System.IO.File]::ReadAllBytes("F:\astock-src\src\lib\collector\collect.ts")
$text = [System.Text.Encoding]::UTF8.GetString($bytes)

$old = "for (const batch of chunk(limitUpRows, 400)) await db.limitUp.createMany({ data: batch });"
$new = "const uniqLimitUp = limitUpRows.filter((r, i) => limitUpRows.findIndex(x => x.tradeDate === r.tradeDate && x.stockCode === r.stockCode) === i);`n  for (const batch of chunk(uniqLimitUp, 400)) await db.limitUp.createMany({ data: batch });"
$text = $text.Replace($old, $new)

$old2 = "for (const batch of chunk(brokenRows, 400)) await db.brokenLimit.createMany({ data: batch });"
$new2 = "const uniqBroken = brokenRows.filter((r, i) => brokenRows.findIndex(x => x.tradeDate === r.tradeDate && x.stockCode === r.stockCode) === i);`n  for (const batch of chunk(uniqBroken, 400)) await db.brokenLimit.createMany({ data: batch });"
$text = $text.Replace($old2, $new2)

$old3 = "for (const batch of chunk(limitDownRows, 400)) await db.limitDown.createMany({ data: batch });"
$new3 = "const uniqDown = limitDownRows.filter((r, i) => limitDownRows.findIndex(x => x.tradeDate === r.tradeDate && x.stockCode === r.stockCode) === i);`n  for (const batch of chunk(uniqDown, 400)) await db.limitDown.createMany({ data: batch });"
$text = $text.Replace($old3, $new3)

$old4 = "for (const batch of chunk(boardHistRows, 400)) await db.boardHistory.createMany({ data: batch });"
$new4 = "const uniqBoard = boardHistRows.filter((r, i) => boardHistRows.findIndex(x => x.tradeDate === r.tradeDate && x.stockCode === r.stockCode) === i);`n  for (const batch of chunk(uniqBoard, 400)) await db.boardHistory.createMany({ data: batch });"
$text = $text.Replace($old4, $new4)

[System.IO.File]::WriteAllBytes("F:\astock-src\src\lib\collector\collect.ts", [System.Text.Encoding]::UTF8.GetBytes($text))
Write-Output "done"
Write-Output "换行符: $((([System.Text.Encoding]::UTF8.GetBytes($text)) | Where-Object { $_ -eq 10 }).Count)"
