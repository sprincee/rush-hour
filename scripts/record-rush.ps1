<#
.SYNOPSIS
    Saves a finished rush's exact order timings to web/test/fixtures/real-rush.json.
    The game's calibration test compares its simulation against this recording.
.EXAMPLE
    .\scripts\rush.ps1 -Record     # Usually run this way, right after a rush
#>
[CmdletBinding()]
param([Parameter(Mandatory)][string]$RushId)

$Context = 'k3d-rush-hour'
$Root = Split-Path -Parent $PSScriptRoot
$Out = "$Root\web\test\fixtures\real-rush.json"

# Same hash the tests compute, so a recording made with different settings is caught.
$configHash = (Get-FileHash "$Root\shop\config.json" -Algorithm SHA256).Hash.Substring(0, 16).ToLower()
$baristas = kubectl --context $Context get deployment barista -n rush-hour -o 'jsonpath={.spec.replicas}'

$json = Get-Content "$PSScriptRoot\record_orders.py" -Raw |
    kubectl --context $Context exec -i -n rush-hour deploy/register -- python - $RushId $baristas $configHash
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Could not read the orders from Redis.' -ForegroundColor Red
    exit 1
}
$text = ($json -join "`n") + "`n"
$recording = $text | ConvertFrom-Json
$expected = (Get-Content "$Root\shop\config.json" -Raw | ConvertFrom-Json).rush.customers
$ready = @($recording.orders | Where-Object { $_.status -eq 'ready' }).Count
if ($ready -ne $expected) {
    Write-Host "Not saving: found $ready ready orders for rush $RushId, expected $expected." -ForegroundColor Red
    exit 1
}

New-Item -ItemType Directory -Force (Split-Path $Out) | Out-Null
[IO.File]::WriteAllText($Out, $text, (New-Object Text.UTF8Encoding $false))
Write-Host "Recorded rush $RushId ($ready orders, $baristas baristas) to web\test\fixtures\real-rush.json." -ForegroundColor Green
Write-Host 'Check it against the game:  cd web; npm test'
