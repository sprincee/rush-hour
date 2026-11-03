<#
.SYNOPSIS
    Sends one fixed rush of 50 orders and reports whether every order got made.
.PARAMETER KillBarista
    Force-kills one barista partway through, to test crash recovery.
.EXAMPLE
    .\scripts\rush.ps1
.EXAMPLE
    .\scripts\rush.ps1 -KillBarista
#>
[CmdletBinding()]
param([switch]$KillBarista)

$ErrorActionPreference = 'Continue'

$Context = 'k3d-rush-hour'
$Root = Split-Path -Parent $PSScriptRoot
$Namespace = 'rush-load'
$KillAfterSeconds = 25
$WaitLimitSeconds = 370  # Slightly longer than the Job's own hard deadline.

function Invoke-Kubectl {
    kubectl --context $Context --request-timeout=20s @args
}

# A finished Job can't be rerun, so remove the previous rush first.
Invoke-Kubectl delete job rush -n $Namespace --ignore-not-found --wait=true | Out-Null
Invoke-Kubectl apply -f "$Root\k8s\rush\setup.yaml" | Out-Null
Invoke-Kubectl apply -f "$Root\k8s\rush\job.yaml"
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Could not start the rush. Has .\scripts\up.ps1 been run?' -ForegroundColor Red
    exit 1
}

Write-Host 'Rush started: 50 orders arriving over 10 seconds.' -ForegroundColor Cyan
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

if ($succeeded) {
    Write-Host "PASSED: every order was made. Took about $seconds seconds." -ForegroundColor Green
    exit 0
}
Write-Host "FAILED after about $seconds seconds. Check the output above." -ForegroundColor Red
exit 1
