# Copia ou restaura uma pasta de dados do Helicon.
# Não escolhe a pasta real. Feche o aplicativo antes de usar as pastas da instalação.
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Destination,
  [switch]$Restore,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

function Get-FullDir([string]$path) {
  $full = [IO.Path]::GetFullPath($path)
  return $full.TrimEnd("\", "/")
}

function Test-HeliconLiveDataPath([string]$full) {
  $roots = @(
    (Join-Path $env:APPDATA "app.helicon.desktop"),
    (Join-Path $env:LOCALAPPDATA "app.helicon.desktop"),
    (Join-Path $env:APPDATA "app.helicon.desktop.test"),
    (Join-Path $env:LOCALAPPDATA "app.helicon.desktop.test")
  )
  foreach ($root in $roots) {
    if (-not $root) { continue }
    $base = Get-FullDir $root
    if ($full.Equals($base, [StringComparison]::OrdinalIgnoreCase)) { return $true }
    if ($full.StartsWith($base + "\", [StringComparison]::OrdinalIgnoreCase)) { return $true }
  }
  return $false
}

function Test-HeliconRunning {
  $found = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ProcessName -match "^(helicon|helicon-teste)$"
  })
  return $found.Count -gt 0
}

function Assert-AppClosed([string[]]$paths) {
  $live = @($paths | Where-Object { Test-HeliconLiveDataPath $_ })
  if ($live.Count -eq 0) { return }
  if (Test-HeliconRunning) {
    throw "Feche o Helicon e o Helicon Teste antes de copiar ou restaurar a pasta de dados da instalação."
  }
}

function Get-Sha256OrAbsent([string]$file) {
  if (-not (Test-Path -LiteralPath $file)) { return "ausente" }
  return (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Copy-Tree([string]$from, [string]$to) {
  New-Item -ItemType Directory -Path $to -Force | Out-Null
  & robocopy $from $to /E /COPY:DAT /R:2 /W:1 /NFL /NDL /NP | Out-Null
  $code = $LASTEXITCODE
  if ($code -ge 8) {
    throw "A cópia falhou (robocopy $code)."
  }
}

function Write-Manifest([string]$dir, [string]$origin) {
  $files = @(Get-ChildItem -LiteralPath $dir -Recurse -File -Force | Where-Object { $_.Name -ne "MANIFESTO.txt" })
  $lines = @(
    "origem=$origin",
    ("quando=" + (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")),
    ("arquivos=" + $files.Count),
    ("sha256 helicon.db=" + (Get-Sha256OrAbsent (Join-Path $dir "helicon.db"))),
    ("sha256 file-drafts.json=" + (Get-Sha256OrAbsent (Join-Path $dir "file-drafts.json")))
  )
  Set-Content -LiteralPath (Join-Path $dir "MANIFESTO.txt") -Value $lines -Encoding utf8
}

function Assert-Manifest([string]$dir) {
  $manifest = Join-Path $dir "MANIFESTO.txt"
  if (-not (Test-Path -LiteralPath $manifest)) { return }
  $map = @{}
  foreach ($line in Get-Content -LiteralPath $manifest) {
    $pair = $line -split "=", 2
    if ($pair.Count -eq 2) { $map[$pair[0]] = $pair[1] }
  }
  foreach ($name in @("helicon.db", "file-drafts.json")) {
    $key = "sha256 $name"
    if (-not $map.ContainsKey($key) -or $map[$key] -eq "ausente") { continue }
    $actual = Get-Sha256OrAbsent (Join-Path $dir $name)
    if ($actual -ne $map[$key]) {
      throw "O arquivo $name restaurado não confere com o manifesto."
    }
  }
}

$sourceFull = Get-FullDir $Source
$destFull = Get-FullDir $Destination
if ($sourceFull.Equals($destFull, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Origem e destino são a mesma pasta."
}
if (-not (Test-Path -LiteralPath $sourceFull -PathType Container)) {
  throw "A pasta de origem não existe."
}

Assert-AppClosed @($sourceFull, $destFull)

if ($Restore) {
  if (Test-Path -LiteralPath $destFull) {
    $children = @(Get-ChildItem -LiteralPath $destFull -Force)
    if ($children.Count -gt 0 -and -not $Force) {
      throw "O destino já tem arquivos. Use -Force para renomeá-lo antes de restaurar."
    }
    if ($children.Count -gt 0) {
      $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
      $aside = "$destFull.antes-$stamp"
      if (Test-Path -LiteralPath $aside) {
        throw "Já existe uma pasta de reserva com este horário. Espere um segundo e tente de novo."
      }
      Rename-Item -LiteralPath $destFull -NewName (Split-Path -Leaf $aside)
    } else {
      Remove-Item -LiteralPath $destFull
    }
  }
  $parent = Split-Path -Parent $destFull
  if ($parent -and -not (Test-Path -LiteralPath $parent)) {
    throw "A pasta pai do destino não existe."
  }
  Copy-Tree $sourceFull $destFull
  Assert-Manifest $destFull
  Write-Output "Restaurado em $destFull"
  return
}

if (Test-Path -LiteralPath $destFull) {
  throw "O destino do backup já existe. Escolha uma pasta nova."
}
$parent = Split-Path -Parent $destFull
if ($parent -and -not (Test-Path -LiteralPath $parent)) {
  throw "A pasta pai do destino não existe."
}
Copy-Tree $sourceFull $destFull
Write-Manifest $destFull $sourceFull
Write-Output "Backup em $destFull"
