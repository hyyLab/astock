$bytes = [System.IO.File]::ReadAllBytes("F:\astock-src\src\lib\collector\collect.ts")
$text = [System.Text.Encoding]::UTF8.GetString($bytes)

$old1 = "backfillDays?: number; // 鍥炶ˉ鐨勪氦鏄撴棩鏁伴噺锛堥粯璁?0锛?  preWindowDays?: number;"
$new1 = "backfillDays?: number; // huiBuDeJiaoYiRiShuLiang (moRen 10)`n  preWindowDays?: number;"
$text = $text.Replace($old1, $new1)

$old2 = "klineBars?: number; // 姣忓彧鑲＄エ鎷夊彇鐨凨绾挎牴鏁?}"
$new2 = "klineBars?: number; // meiZhiGuPiaoLaQuDeKXianGenshu`n}"
$text = $text.Replace($old2, $new2)

[System.IO.File]::WriteAllBytes("F:\astock-src\src\lib\collector\collect.ts", [System.Text.Encoding]::UTF8.GetBytes($text))
Write-Output "done"
$lines = ([System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes("F:\astock-src\src\lib\collector\collect.ts"))) -split "`n"
for ($i = 37; $i -lt 44; $i++) { Write-Output "[$($i+1)] $($lines[$i])" }
