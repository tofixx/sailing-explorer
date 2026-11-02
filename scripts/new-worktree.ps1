<#
.SYNOPSIS
  Legt einen Worktree fuer einen neuen Auftrag an (CLAUDE.md "Lokale Arbeit").
.DESCRIPTION
  - git worktree add (neuer Branch ab -Base, Standard: aktueller HEAD; vorhandener Branch wird ausgecheckt)
  - kappt das Upstream, damit ein versehentliches "git push" nicht auf den Basis-Branch zielt
  - node_modules: Junction auf dieses Repo, wenn package-lock.json gleich ist (vite.config.ts gibt den echten Pfad
    frei), sonst bzw. mit -Install ein eigenes npm ci
  - gibt einen freien Vite-Port aus (ab 5173)
  Entfernen nur mit scripts/remove-worktree.ps1 (loest die Junction vorher), nie mit Remove-Item -Recurse.
.EXAMPLE
  powershell -File scripts/new-worktree.ps1 feature/umfragen "C:\Users\tobia\claude temp\sailing-explorer-umfragen"
#>
param(
  [Parameter(Mandatory = $true)][string]$Branch,
  [Parameter(Mandatory = $true)][string]$Folder,
  [string]$Base = 'HEAD',
  [switch]$Install
)
# Continue: git schreibt Fortschritt nach stderr; Fehler werden ueber $LASTEXITCODE geprueft.
$ErrorActionPreference = 'Continue'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (Test-Path $Folder) { throw "Ordner existiert schon: $Folder" }

git -C $repo show-ref --verify --quiet "refs/heads/$Branch"
if ($LASTEXITCODE -eq 0) {
  git -C $repo worktree add $Folder $Branch
} else {
  git -C $repo worktree add -b $Branch $Folder $Base
}
if ($LASTEXITCODE -ne 0) { throw 'git worktree add fehlgeschlagen' }
$Folder = (Resolve-Path $Folder).Path

# Upstream kappen (ein neuer Branch erbt sonst ggf. den des Basis-Branches)
if (git -C $Folder config --get "branch.$Branch.remote") { git -C $Folder branch --unset-upstream }

# node_modules: Junction bei gleichem Lockfile, sonst eigenes npm ci
$src = Join-Path $repo 'node_modules'
$same = (Test-Path $src) -and ((Get-FileHash (Join-Path $repo 'package-lock.json')).Hash -eq (Get-FileHash (Join-Path $Folder 'package-lock.json')).Hash)
if ($same -and -not $Install) {
  $real = (Get-Item $src).Target
  if (-not $real) { $real = $src } elseif ($real -is [array]) { $real = $real[0] }
  New-Item -ItemType Junction -Path (Join-Path $Folder 'node_modules') -Target $real | Out-Null
  $modules = "Junction -> $real"
} else {
  Push-Location $Folder
  try { npm ci --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'npm ci fehlgeschlagen' } } finally { Pop-Location }
  $modules = 'eigenes npm ci'
}

# freien Port fuer den Dev-Server suchen
$port = 5173
while ($port -lt 5300) {
  $l = $null
  try { $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $port); $l.Start(); $l.Stop(); break }
  catch { $port++ }
}

Write-Output "Worktree:     $Folder"
Write-Output "Branch:       $Branch (ohne Upstream; erster Push: git push -u origin $Branch)"
Write-Output "node_modules: $modules"
Write-Output "Vite-Port:    $port  (npx vite --port $port, lokale D1 vorher: npm run db:migrate:local)"
Write-Output 'Nummern:      vor der ersten F-ID/Migration/Konzept-Datei die Reservierung in docs/ROADMAP.md eintragen'
