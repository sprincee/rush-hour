<#
.SYNOPSIS
    Sends one rush, the same customers the game simulates, and reports whether every order got made.
.PARAMETER Rush
    Which rush from shop/config.json to send, such as lesson-2 or lesson-3-1.
.PARAMETER Baristas
    Set the number of barista Pods before the rush, to match a game design.
.PARAMETER Rule
    Set how baristas pick the next ticket: fifo, walkin, mobile, or weighted.
.PARAMETER Every
    For -Rule weighted: every Nth drink comes from the app rail.
.PARAMETER Batch
    Steam milk for two lattes at once. Use -Batch:$false to turn it off.
.PARAMETER BatchWait
    With -Batch: shop minutes a barista holds a lone latte, hoping a second one arrives.
.PARAMETER Sync
    Make the register synchronous: one order at a time, each request held open until
    its drink is ready (lesson 1). Use -Sync:$false to switch back.
.PARAMETER KillBarista
    Force-kills one barista partway through. If it finishes its drink first, no
    order needs rescuing, so watch "Orders rescued" on the dashboard.
.PARAMETER Record
    After a successful rush, saves its exact timings for the game's calibration test.
.EXAMPLE
    .\scripts\rush.ps1
.EXAMPLE
    .\scripts\rush.ps1 -Rush lesson-3-2 -Baristas 3 -Rule weighted -Every 5 -Record
#>
[CmdletBinding()]
param(
    [string]$Rush = 'lesson-2',
    [ValidateRange(1, 4)][int]$Baristas,
    [ValidateSet('fifo', 'walkin', 'mobile', 'weighted')][string]$Rule,
    [ValidateRange(1, 10)][int]$Every = 3,
    [switch]$Batch,
    [ValidateRange(0, 6)][int]$BatchWait,
    [switch]$Sync,
    [switch]$KillBarista,
    [switch]$Record,
    # rush-hour-aws: the AWS server, after .\scripts\aws-up.ps1.
    [ValidateSet('rush-hour', 'rush-hour-single', 'rush-hour-aws')][string]$Cluster = 'rush-hour'
)

$ErrorActionPreference = 'Continue'

$Context = if ($Cluster -eq 'rush-hour-aws') { $Cluster } else { "k3d-$Cluster" }
$Root = Split-Path -Parent $PSScriptRoot
$Namespace = 'rush-load'
$KillAfterSeconds = 25
$WaitLimitSeconds = 370  # Slightly longer than the Job's own hard deadline.
$RushId = Get-Date -Format 'yyyyMMddHHmmss'

function Invoke-Kubectl {
    kubectl --context $Context --request-timeout=20s @args
}

$settings = (Get-Content "$Root\shop\config.json" -Raw | ConvertFrom-Json).rushes.$Rush
if (-not $settings) {
    Write-Host "shop/config.json has no rush named '$Rush'." -ForegroundColor Red
    exit 1
}

# Match the baristas to the design being tested. scripts/up.ps1 resets them to the defaults.
# One change at a time: scaling in the middle of a rollout makes Kubernetes spread Pods
# across the old and new versions, and a short-lived old barista can take a ticket and
# vanish before making it. That order then waits 30 seconds to be rescued.
function Wait-Baristas([int]$Expected) {
    Invoke-Kubectl rollout status deployment/barista -n rush-hour --timeout=120s | Out-Null
    # Rollout status can finish while old Pods are still shutting down; wait for them to go.
    for ($i = 0; $i -lt 60; $i++) {
        $pods = @(Invoke-Kubectl get pods -n rush-hour -l app=barista -o name)
        if ($pods.Count -eq $Expected) { return }
        Start-Sleep -Seconds 1
    }
    Write-Host 'Warning: old baristas are still shutting down.' -ForegroundColor Yellow
}
$replicas = [int](Invoke-Kubectl get deployment barista -n rush-hour -o 'jsonpath={.spec.replicas}')
if ($Baristas -and $Baristas -ne $replicas) {
    Write-Host "Scaling to $Baristas baristas." -ForegroundColor Cyan
    Invoke-Kubectl scale deployment/barista -n rush-hour --replicas=$Baristas | Out-Null
    $replicas = $Baristas
    Wait-Baristas $replicas
}
# Settings change together in one rollout. 1 real second is 1 shop minute, so BATCH_WAIT
# in real seconds is the batch window in shop minutes.
$settingsChanges = @()
if ($Rule) { $settingsChanges += "TICKET_RULE=$Rule", "MOBILE_EVERY=$Every" }
if ($PSBoundParameters.ContainsKey('Batch')) { $settingsChanges += "BATCH=$(if ($Batch) { 'on' } else { 'off' })" }
if ($PSBoundParameters.ContainsKey('BatchWait')) { $settingsChanges += "BATCH_WAIT=$BatchWait" }
if ($settingsChanges) {
    Write-Host "Baristas will use: $($settingsChanges -join ', ')." -ForegroundColor Cyan
    Invoke-Kubectl set env deployment/barista -n rush-hour @settingsChanges | Out-Null
    Wait-Baristas $replicas
}
if ($PSBoundParameters.ContainsKey('Sync')) {
    $mode = if ($Sync) { 'sync' } else { 'async' }
    Write-Host "Register will run in $mode mode." -ForegroundColor Cyan
    Invoke-Kubectl set env deployment/register -n rush-hour REGISTER_MODE=$mode | Out-Null
    Invoke-Kubectl rollout status deployment/register -n rush-hour --timeout=120s | Out-Null
    for ($i = 0; $i -lt 60; $i++) {
        if (@(Invoke-Kubectl get pods -n rush-hour -l app=register -o name).Count -eq 1) { break }
        Start-Sleep -Seconds 1
    }
}
if ($settingsChanges -or $Baristas -or $PSBoundParameters.ContainsKey('Sync')) { Start-Sleep -Seconds 3 }  # Let new Pods settle.

# A finished Job can't be rerun, so remove the previous rush first.
Invoke-Kubectl delete job rush -n $Namespace --ignore-not-found --wait=true | Out-Null
Invoke-Kubectl apply -f "$Root\k8s\rush\setup.yaml" | Out-Null

# The rush script, the shared arrival schedule, the shop settings, and this rush's ID and name.
Invoke-Kubectl create configmap rush-script -n $Namespace `
    --from-file=rush.js="$Root\k8s\rush\rush.js" `
    --from-file=arrivals.js="$Root\web\src\arrivals.mjs" `
    --from-file=config.json="$Root\shop\config.json" `
    --from-literal=rush-id=$RushId `
    --from-literal=rush-name=$Rush `
    --dry-run=client -o yaml | kubectl --context $Context apply -f - | Out-Null

Invoke-Kubectl apply -f "$Root\k8s\rush\job.yaml"
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Could not start the rush. Has .\scripts\up.ps1 been run?' -ForegroundColor Red
    exit 1
}

Write-Host "Rush $RushId ($Rush) started: $($settings.customers) customers, arriving as the game schedules them." -ForegroundColor Cyan
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
        & "$PSScriptRoot\record-rush.ps1" -RushId $RushId -Rush $Rush
        exit $LASTEXITCODE
    }
}
exit 0
