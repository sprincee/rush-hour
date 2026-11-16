<#
.SYNOPSIS
    Builds the course site into dist/ and serves it at http://127.0.0.1:8080 (this laptop only).
.PARAMETER BuildOnly
    Build without starting the local server.
.EXAMPLE
    .\scripts\site.ps1
#>
[CmdletBinding()]
param([switch]$BuildOnly)

$Root = Split-Path -Parent $PSScriptRoot
$Python = "$Root\.venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
    Write-Host 'No .venv found. Create it with: python -m venv .venv' -ForegroundColor Red
    exit 1
}

& $Python -m pip install --quiet --disable-pip-version-check -r "$Root\lessons\requirements.txt"
& $Python "$Root\lessons\build.py"
if ($LASTEXITCODE -ne 0) { Write-Host 'Build failed.' -ForegroundColor Red; exit 1 }
if ($BuildOnly) { exit 0 }

# The game loads its code as modules, which browsers only allow over http, not from a file.
# serve.py turns off browser caching, so a normal reload always shows the latest build.
& $Python "$Root\scripts\serve.py" 8080
