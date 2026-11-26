Set-Location F:\astock-src
bun test-skipdup.cjs 2>&1 | Out-File -FilePath test-skipdup-out.txt -Encoding UTF8
Get-Content test-skipdup-out.txt | Select-Object -Last 40
