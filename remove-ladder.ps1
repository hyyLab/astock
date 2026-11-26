$path = "F:\astock-src\src\components\lb\ReviewView.tsx"
$bytes = [System.IO.File]::ReadAllBytes($path)
$text = [System.Text.Encoding]::UTF8.GetString($bytes)

# 1) 删掉 import
$oldImport = 'import BoardLadder from "./BoardLadder";' + "`r`n"
if (-not $text.Contains($oldImport)) { $oldImport = 'import BoardLadder from "./BoardLadder";' + "`n" }
$c1 = ([regex]::Matches($text, [regex]::Escape($oldImport))).Count
$text = $text.Replace($oldImport, '')
Write-Output "import removed: $c1"

# 2) 删掉天梯+主线的 grid 块，只留 MainThemes
$old = @'
      {/* 杩炴澘澶╂ + 涓荤嚎棰樻潗 */}
      <div className="grid gap-3 xl:grid-cols-[5fr_4fr]">
        <BoardLadder bundle={bundle} />
        <MainThemes bundle={bundle} />
      </div>
'@
$old = $old -replace "`r`n", "`n"
if (-not $text.Contains($old)) { Write-Output "WARN: block not found verbatim" }
$c2 = ([regex]::Matches($text, [regex]::Escape($old))).Count
$new = @'
      {/* 涓荤嚎棰樻潗 */}
      <MainThemes bundle={bundle} />
'@
$new = $new -replace "`r`n", "`n"
$text = $text.Replace($old, $new)
Write-Output "block replaced: $c2"

[System.IO.File]::WriteAllBytes($path, [System.Text.Encoding]::UTF8.GetBytes($text))
$n = ([System.Text.Encoding]::UTF8.GetBytes($text) | Where-Object { $_ -eq 10 }).Count
Write-Output "newlines: $n"
