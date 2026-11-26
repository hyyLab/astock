$path = "F:\astock-src\src\components\lb\BoardLadder.tsx"
$bytes = [System.IO.File]::ReadAllBytes($path)
$text = [System.Text.Encoding]::UTF8.GetString($bytes)

$old = 'className="hidden shrink-0 truncate text-[11px] text-dim xl:inline"'
$new = 'className="hidden min-w-0 truncate text-[11px] text-dim xl:inline"'
$c = ([regex]::Matches($text, [regex]::Escape($old))).Count
$text = $text.Replace($old, $new)
Write-Output "industry span replaced: $c"

[System.IO.File]::WriteAllBytes($path, [System.Text.Encoding]::UTF8.GetBytes($text))
$n = ([System.Text.Encoding]::UTF8.GetBytes($text) | Where-Object { $_ -eq 10 }).Count
Write-Output "newlines kept: $n"
