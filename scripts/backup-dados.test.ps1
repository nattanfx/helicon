# Exercita backup e restauração em pastas temporárias. Não toca nas pastas reais do Helicon.
$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "backup-dados.ps1"
$root = Join-Path ([IO.Path]::GetTempPath()) ("helicon-backup-test-" + [guid]::NewGuid().ToString("n"))
New-Item -ItemType Directory -Path $root | Out-Null

function Assert-Equal($actual, $expected, [string]$label) {
  if ($actual -ne $expected) {
    throw "$label : esperado '$expected', obtido '$actual'"
  }
}

try {
  $source = Join-Path $root "dados"
  $backup = Join-Path $root "copia"
  New-Item -ItemType Directory -Path $source | Out-Null
  Set-Content -LiteralPath (Join-Path $source "helicon.db") -Value "banco-um" -Encoding ascii -NoNewline
  Set-Content -LiteralPath (Join-Path $source "file-drafts.json") -Value '{"vazio":""}' -Encoding ascii -NoNewline
  New-Item -ItemType Directory -Path (Join-Path $source "extra") | Out-Null
  Set-Content -LiteralPath (Join-Path $source "extra\nota.txt") -Value "ok" -Encoding ascii -NoNewline

  & $script -Source $source -Destination $backup
  if (-not $?) { throw "backup falhou" }
  Assert-Equal (Get-Content -LiteralPath (Join-Path $backup "helicon.db") -Raw) "banco-um" "cópia do banco"
  $manifest = Get-Content -LiteralPath (Join-Path $backup "MANIFESTO.txt")
  if (-not ($manifest -match "^sha256 helicon.db=[0-9a-f]{64}$")) { throw "manifesto sem hash do banco" }
  if (-not ($manifest -match "^arquivos=3$")) { throw "manifesto deveria contar 3 arquivos" }

  $refused = $false
  try { & $script -Source $source -Destination $backup } catch { $refused = $true }
  if (-not $refused) { throw "backup sobre pasta existente deveria falhar" }

  Set-Content -LiteralPath (Join-Path $source "helicon.db") -Value "banco-dois" -Encoding ascii -NoNewline
  & $script -Restore -Force -Source $backup -Destination $source
  if (-not $?) { throw "restauração falhou" }
  Assert-Equal (Get-Content -LiteralPath (Join-Path $source "helicon.db") -Raw) "banco-um" "banco restaurado"
  Assert-Equal (Get-Content -LiteralPath (Join-Path $source "file-drafts.json") -Raw) '{"vazio":""}' "rascunho restaurado"
  $kept = @(Get-ChildItem -LiteralPath $root -Force -Directory | Where-Object { $_.Name -like "dados.antes-*" })
  if ($kept.Count -ne 1) { throw "a pasta anterior à restauração não foi preservada" }
  Assert-Equal (Get-Content -LiteralPath (Join-Path $kept[0].FullName "helicon.db") -Raw) "banco-dois" "banco anterior preservado"

  $samePath = $false
  try { & $script -Source $source -Destination $source } catch { $samePath = $true }
  if (-not $samePath) { throw "origem igual ao destino deveria falhar" }

  Write-Output "backup-dados.test.ps1 ok"
} finally {
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
