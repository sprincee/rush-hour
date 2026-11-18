<#
.SYNOPSIS
    Brings up the whole Rush Hour system on this laptop. Safe to run repeatedly.
.EXAMPLE
    .\scripts\up.ps1
.EXAMPLE
    .\scripts\up.ps1 -Single
    A separate one-node cluster (rush-hour-single), shaped like the AWS server.
#>
[CmdletBinding()]
param(
    [switch]$Single
)

# Native tools write progress to stderr, so failures are detected by exit code in Invoke-Step.
$ErrorActionPreference = 'Continue'

$Root = Split-Path -Parent $PSScriptRoot
$ClusterName = if ($Single) { 'rush-hour-single' } else { 'rush-hour' }
$ClusterConfig = if ($Single) { "$Root\k8s\k3d-single.yaml" } else { "$Root\k8s\k3d-cluster.yaml" }
$Context = "k3d-$ClusterName"
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

foreach ($tool in 'docker', 'k3d', 'kubectl', 'helm') {
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
    Invoke-Step 'Creating the cluster' { k3d cluster create --config $ClusterConfig }
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

# Everything after the images is shared with the AWS server: scripts/deploy-shop.ps1.
# The image tag stays ":dev", so restart whatever was rebuilt.
& "$PSScriptRoot\deploy-shop.ps1" -Context $Context -Restart $changed
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host ''
Write-Host 'Rush Hour is up.' -ForegroundColor Green
kubectl --context $Context get pods -n rush-hour
Write-Host ''
Write-Host "Send a rush:   .\scripts\rush.ps1$(if ($Single) { ' -Cluster rush-hour-single' })"
Write-Host 'Open Grafana:  .\scripts\grafana.ps1'
Write-Host "Tear it down:  k3d cluster delete $ClusterName"
