<#
.SYNOPSIS
    Sends one rush, the same customers the game simulates, and reports whether every order got made.
.PARAMETER KillBarista
    Force-kills one barista partway through. If it finishes its drink first, no
    order needs rescuing, so watch "Orders rescued" on the dashboard.
.PARAMETER Record
    After a successful rush, saves its exact timings for the game's calibration test.
.EXAMPLE
    .\scripts\rush.ps1
.EXAMPLE
    .\scripts\rush.ps1 -Record
#>
[CmdletBinding()]
param([switch]$KillBarista, [switch]$Record)

$ErrorActionPreference = 'Continue'

$Context = 'k3d-rush-hour'
$Root = Split-Path -Parent $PSScriptRoot
$Namespace = 'rush-load'
$KillAfterSeconds = 25
$WaitLimitSeconds = 370  # Slightly longer than the Job's own hard deadline.
$RushId = Get-Date -Format 'yyyyMMddHHmmss'

function Invoke-Kubectl {
    kubectl --context $Context --request-timeout=20s @args
}

# A finished Job can't be rerun, so remove the previous rush first.
Invoke-Kubectl delete job rush -n $Namespace --ignore-not-found --wait=true | Out-Null
Invoke-Kubectl apply -f "$Root\k8s\rush\setup.yaml" | Out-Null

# The rush script, the shared arrival schedule, the shop settings, and this rush's ID.
Invoke-Kubectl create configmap rush-script -n $Namespace `
    --from-file=rush.js="$Root\k8s\rush\rush.js" `
    --from-file=arrivals.js="$Root\web\src\arrivals.mjs" `
    --from-file=config.json="$Root\shop\config.json" `
    --from-literal=rush-id=$RushId `
    --dry-run=client -o yaml | kubectl --context $Context apply -f - | Out-Null

Invoke-Kubectl apply -f "$Root\k8s\rush\job.yaml"
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Could not start the rush. Has .\scripts\up.ps1 been run?' -ForegroundColor Red
    exit 1
}

$customers = (Get-Content "$Root\shop\config.json" -Raw | ConvertFrom-Json).rush.customers
Write-Host "Rush $RushId started: $customers customers, arriving as the game schedules them." -ForegroundColor Cyan
$timer = [Diagnostics.Stopwatch]::StartNew()
$killed = -not $KillBarista
$succeeded = $null
$failed = $null

while ($timer.Elapsed.TotalSeconds -lt $WaitLimitSeconds) {
    if (-not $killed -and $timer.Elapsed.TotalSeconds -ge $KillAfterSeconds) {
        $victim = Invoke-Kubectl get pods -n rush-hour -l app=barista -o 'jsonpath={.items[0].metadata.name}'
        Write-Host "Killing $victim" -ForegroundColor Yellow
        Invoke-Kubectl delete pod $victim -n rush-hour --force --grace-period=0 2>$null | Out-Null
        $killed = $true
    }

    $succeeded = Invoke-Kubectl get job rush -n $Namespace -o 'jsonpath={.status.succeeded}'
    $failed = Invoke-Kubectl get job rush -n $Namespace -o 'jsonpath={.status.failed}'
    if ($succeeded -or $failed) { break }
    Start-Sleep -Seconds 2
}

$seconds = [math]::Round($timer.Elapsed.TotalSeconds)
Write-Host ''
Invoke-Kubectl logs job/rush -n $Namespace
Write-Host ''

if (-not $succeeded) {
    Write-Host "FAILED after about $seconds seconds. Check the output above." -ForegroundColor Red
    exit 1
}
Write-Host "PASSED: every order was made. Took about $seconds seconds." -ForegroundColor Green

if ($Record) {
    if ($KillBarista) {
        Write-Host 'Not recording: a rush with a killed barista would not match the game.' -ForegroundColor Yellow
    } else {
        & "$PSScriptRoot\record-rush.ps1" -RushId $RushId
        exit $LASTEXITCODE
    }
}
exit 0
