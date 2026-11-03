<#
.SYNOPSIS
    Brings up the whole Rush Hour system on this laptop. Safe to run repeatedly.
.EXAMPLE
    .\scripts\up.ps1
#>
[CmdletBinding()]
param()

# Native tools write progress to stderr, so failures are detected by exit code in Invoke-Step.
$ErrorActionPreference = 'Continue'

$ClusterName = 'rush-hour'
$Context = "k3d-$ClusterName"
$Root = Split-Path -Parent $PSScriptRoot
$Services = @('register', 'barista')

function Invoke-Step {
    param([string]$What, [scriptblock]$Action)
    Write-Host "==> $What" -ForegroundColor Cyan
    & $Action
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FAILED: $What" -ForegroundColor Red
        exit 1
    }
}

function Get-ImageId {
    param([string]$Image)
    $id = docker image inspect --format '{{.Id}}' $Image 2>$null
    if ($LASTEXITCODE -ne 0) { $global:LASTEXITCODE = 0; return '' }
    return $id
}

foreach ($tool in 'docker', 'k3d', 'kubectl') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        Write-Host "Missing '$tool'. Install it, then open a new terminal." -ForegroundColor Red
        exit 1
    }
}

docker version --format '{{.Server.Version}}' *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Docker is not running. Start Docker Desktop and try again.' -ForegroundColor Red
    exit 1
}

# k3d's JSON listing tells us if the cluster exists and how many servers are running.
$cluster = k3d cluster list -o json | ConvertFrom-Json | Where-Object { $_.name -eq $ClusterName }
if (-not $cluster) {
    Invoke-Step 'Creating the cluster' { k3d cluster create --config "$Root\k8s\k3d-cluster.yaml" }
} else {
    Invoke-Step 'Starting the cluster if it is stopped' { k3d cluster start $ClusterName }
    Invoke-Step 'Pointing kubectl at the cluster' {
        k3d kubeconfig merge $ClusterName --kubeconfig-merge-default --kubeconfig-switch-context | Out-Null
    }
}

$changed = @()
foreach ($service in $Services) {
    $image = "rush-hour-${service}:dev"
    $before = Get-ImageId $image
    # Without --provenance=false, build timestamps change the image ID on every build.
    Invoke-Step "Building $service" {
        docker build -q --provenance=false -t $image "$Root\services\$service" | Out-Null
    }
    if ((Get-ImageId $image) -ne $before) { $changed += $service }
}

$images = $Services | ForEach-Object { "rush-hour-${_}:dev" }
Invoke-Step 'Loading images into the cluster' { k3d image import @images -c $ClusterName }

Invoke-Step 'Creating the namespaces' {
    kubectl --context $Context apply -f "$Root\k8s\app\namespace.yaml"
}
Invoke-Step 'Deploying the shop' { kubectl --context $Context apply -f "$Root\k8s\app" }
Invoke-Step 'Setting up the rush' { kubectl --context $Context apply -f "$Root\k8s\rush\setup.yaml" }

# The image tag stays ":dev", so Kubernetes can't see a rebuild without a restart.
foreach ($service in $changed) {
    Invoke-Step "Restarting $service with its new image" {
        kubectl --context $Context rollout restart "deployment/$service" -n rush-hour
    }
}

foreach ($deployment in 'redis', 'register', 'barista') {
    Invoke-Step "Waiting for $deployment" {
        kubectl --context $Context rollout status "deployment/$deployment" -n rush-hour --timeout=180s
    }
}

Write-Host ''
Write-Host 'Rush Hour is up.' -ForegroundColor Green
kubectl --context $Context get pods -n rush-hour
Write-Host ''
Write-Host 'Send a rush:   .\scripts\rush.ps1'
Write-Host "Tear it down:  k3d cluster delete $ClusterName"
