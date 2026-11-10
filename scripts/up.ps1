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
$MonitoringRepo = 'https://prometheus-community.github.io/helm-charts'
$MonitoringVersion = '92.17.1'

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
    kubectl --context $Context apply -f "$Root\k8s\app\namespace.yaml" -f "$Root\k8s\monitoring\namespace.yaml"
}

# Generate the Grafana password once. It only ever lives in the cluster.
$secret = kubectl --context $Context get secret grafana-admin -n monitoring --ignore-not-found -o name
if (-not $secret) {
    $bytes = New-Object byte[] 24
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $password = [Convert]::ToBase64String($bytes) -replace '[+/=]', 'x'
    Invoke-Step 'Creating the Grafana password' {
        kubectl --context $Context create secret generic grafana-admin -n monitoring `
            --from-literal=admin-user=admin --from-literal=admin-password=$password
    }
}

Invoke-Step 'Installing monitoring (the first run takes a few minutes)' {
    helm upgrade --install monitoring kube-prometheus-stack `
        --repo $MonitoringRepo --version $MonitoringVersion `
        --kube-context $Context -n monitoring -f "$Root\k8s\monitoring\values.yaml" `
        --wait --timeout 10m | Out-Null
}
Invoke-Step 'Loading the dashboard' { kubectl --context $Context apply -k "$Root\k8s\monitoring\dashboards" }
# The menu and prep times, shared with the game. Pods read it as a file.
Invoke-Step 'Loading the shop settings' {
    kubectl --context $Context create configmap shop-config -n rush-hour `
        --from-file=config.json="$Root\shop\config.json" --dry-run=client -o yaml |
        kubectl --context $Context apply -f -
}
Invoke-Step 'Deploying the shop' { kubectl --context $Context apply -f "$Root\k8s\app" }
Invoke-Step 'Setting up the rush' { kubectl --context $Context apply -f "$Root\k8s\rush\setup.yaml" }

# The image tag stays ":dev", so Kubernetes can't see a rebuild without a restart.
foreach ($service in $changed) {
    Invoke-Step "Restarting $service with its new image" {
        kubectl --context $Context rollout restart "deployment/$service" -n rush-hour
    }
}

# Pods only read the settings when they start. Stamping a hash of the settings
# onto each Deployment makes Kubernetes roll them only when the settings change.
$configHash = (Get-FileHash "$Root\shop\config.json" -Algorithm SHA256).Hash.Substring(0, 16).ToLower()
$patchFile = Join-Path $env:TEMP 'rush-hour-config-patch.json'
[IO.File]::WriteAllText($patchFile, "{`"spec`":{`"template`":{`"metadata`":{`"annotations`":{`"shop-config-hash`":`"$configHash`"}}}}}")
foreach ($deployment in 'register', 'barista') {
    $current = kubectl --context $Context get deployment $deployment -n rush-hour -o 'jsonpath={.spec.template.metadata.annotations.shop-config-hash}'
    if ($current -ne $configHash) {
        Invoke-Step "Giving $deployment the current shop settings" {
            kubectl --context $Context patch deployment $deployment -n rush-hour --type merge --patch-file $patchFile
        }
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
Write-Host 'Open Grafana:  .\scripts\grafana.ps1'
Write-Host "Tear it down:  k3d cluster delete $ClusterName"
