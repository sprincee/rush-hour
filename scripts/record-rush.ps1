<#
.SYNOPSIS
    Saves a finished rush's exact order timings to web/test/fixtures/real-rush-<rush>-<rule>.json.
    The game's calibration test compares its simulation against every recording there.
.EXAMPLE
    .\scripts\rush.ps1 -Rush lesson-3-1 -Baristas 3 -Rule walkin -Record   # Usually run this way
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$RushId,
    [string]$Rush = 'lesson-2'
)

$Context = 'k3d-rush-hour'
$Root = Split-Path -Parent $PSScriptRoot

# Same hash the tests compute, so a recording made with different settings is caught.
$configHash = (Get-FileHash "$Root\shop\config.json" -Algorithm SHA256).Hash.Substring(0, 16).ToLower()

# The design the rush ran with: barista count and ticket rule, read from the cluster.
$deployment = kubectl --context $Context get deployment barista -n rush-hour -o json | ConvertFrom-Json
$baristas = $deployment.spec.replicas
$containerEnv = $deployment.spec.template.spec.containers[0].env
$rule = ($containerEnv | Where-Object name -eq 'TICKET_RULE').value
$every = ($containerEnv | Where-Object name -eq 'MOBILE_EVERY').value
$batch = ($containerEnv | Where-Object name -eq 'BATCH').value
$batchWait = ($containerEnv | Where-Object name -eq 'BATCH_WAIT').value
if (-not $rule) { $rule = 'fifo' }
if (-not $every) { $every = '3' }
if (-not $batch) { $batch = 'off' }
if (-not $batchWait) { $batchWait = '0' }

$json = Get-Content "$PSScriptRoot\record_orders.py" -Raw |
    kubectl --context $Context exec -i -n rush-hour deploy/register -- python - $RushId $Rush $baristas $rule $every $batch $batchWait $configHash
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Could not read the orders from Redis.' -ForegroundColor Red
    exit 1
}
$text = ($json -join "`n") + "`n"
$recording = $text | ConvertFrom-Json
$expected = (Get-Content "$Root\shop\config.json" -Raw | ConvertFrom-Json).rushes.$Rush.customers
$ready = @($recording.orders | Where-Object { $_.status -eq 'ready' }).Count
if ($ready -ne $expected) {
    Write-Host "Not saving: found $ready ready orders for rush $RushId, expected $expected." -ForegroundColor Red
    exit 1
}

$name = "real-rush-$Rush-$(if ($rule -eq 'weighted') { "weighted$every" } else { $rule })"
if ($batch -eq 'on') { $name += '-batch' }
if ([int]$batchWait -gt 0) { $name += "-wait$batchWait" }
$name += '.json'
$out = "$Root\web\test\fixtures\$name"
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
[IO.File]::WriteAllText($out, $text, (New-Object Text.UTF8Encoding $false))
Write-Host "Recorded rush $RushId ($Rush, $baristas baristas, rule $rule) to web\test\fixtures\$name." -ForegroundColor Green
Write-Host 'Check it against the game:  cd web; npm test'
