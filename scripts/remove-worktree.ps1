<#
.SYNOPSIS
  Entfernt einen Worktree sicher (CLAUDE.md "Auslieferung" Schritt 4).
.DESCRIPTION
  Loest zuerst eine node_modules-Junction mit "cmd /c rmdir" (loescht nur den Verweis, nie das Ziel) und ruft dann
  "git worktree remove" auf. Ohne -Force bricht git bei ungesicherten Aenderungen ab. Nie Remove-Item -Recurse auf
  einen Worktree: es folgt der Junction und leert das node_modules des anderen Worktrees.
.EXAMPLE
  powershell -File scripts/remove-worktree.ps1 "C:\Users\tobia\claude temp\sailing-explorer-umfragen"
#>
param(
  [Parameter(Mandatory = $true)][string]$Folder,
  [switch]$Force
)
# Continue: git schreibt nach stderr; Fehler werden ueber $LASTEXITCODE geprueft.
$ErrorActionPreference = 'Continue'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Folder = (Resolve-Path $Folder).Path
$main = ((git -C $repo worktree list --porcelain | Select-Object -First 1) -replace '^worktree ', '') -replace '/', '\'
if ($Folder.TrimEnd('\') -ieq $main.TrimEnd('\')) { throw "Das ist der Haupt-Worktree: $Folder" }
if ($Folder.TrimEnd('\') -ieq $repo.TrimEnd('\')) { throw 'Der Worktree, aus dem das Skript laeuft, kann sich nicht selbst entfernen.' }

$nm = Join-Path $Folder 'node_modules'
if (Test-Path $nm) {
  $item = Get-Item $nm -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    cmd /c rmdir "$nm"
    if (Test-Path $nm) { throw "Junction konnte nicht geloest werden: $nm" }
    Write-Output "Junction geloest: $nm"
  }
}

if ($Force) { git -C $repo worktree remove --force $Folder } else { git -C $repo worktree remove $Folder }
if ($LASTEXITCODE -ne 0) { throw 'git worktree remove fehlgeschlagen (ungesicherte Aenderungen? dann pruefen, ggf. -Force)' }
Write-Output "Entfernt: $Folder (Branch bleibt; loeschen mit git branch -d <branch>)"
