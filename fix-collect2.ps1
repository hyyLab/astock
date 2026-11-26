$bytes = [System.IO.File]::ReadAllBytes("F:\astock-src\src\lib\collector\collect.ts")
$text = [System.Text.Encoding]::UTF8.GetString($bytes)
$lines = $text -split "`n"

# 39 行（index 38）：把嵌在注释里的 preWindowDays 拆出来
$lines[38] = "  backfillDays?: number; // huiBuDeJiaoYiRiShuLiang, moRen 10"
# 在它后面插入 preWindowDays 行
$newLines = @()
for ($i = 0; $i -lt $lines.Count; $i++) {
  $newLines += $lines[$i]
  if ($i -eq 38) {
    $newLines += "  preWindowDays?: number; // chuangKouQianZhongZiTianShu"
  }
}
# 现在 40 行（index 39）是原 40 行 klineBars，修它的注释
for ($i = 0; $i -lt $newLines.Count; $i++) {
  if ($newLines[$i] -match '^  klineBars\?: number; //') {
    $newLines[$i] = "  klineBars?: number; // meiZhiGuPiaoLaQuDeKXianGenshu"
  }
}

$text2 = $newLines -join "`n"
[System.IO.File]::WriteAllBytes("F:\astock-src\src\lib\collector\collect.ts", [System.Text.Encoding]::UTF8.GetBytes($text2))
Write-Output "done"
$check = ([System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes("F:\astock-src\src\lib\collector\collect.ts"))) -split "`n"
for ($i = 37; $i -lt 45; $i++) { Write-Output "[$($i+1)] $($check[$i])" }
