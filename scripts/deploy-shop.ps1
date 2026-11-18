<#
.SYNOPSIS
    Deploys the shop and its monitoring onto a running cluster. Safe to run repeatedly.
.DESCRIPTION
    Shared by up.ps1 (the local k3d cluster) and aws-up.ps1 (the AWS server), so both
    run exactly the same manifests. With -Registry and -Tag, the shop's two images come
    from ECR instead of the local ":dev" builds.
.EXAMPLE
    .\scripts\deploy-shop.ps1 -Context k3d-rush-hour
.EXAMPLE
    .\scripts\deploy-shop.ps1 -Context rush-hour-aws -Registry 123456789012.dkr.ecr.us-east-1.amazonaws.com -Tag 1a2b3c4
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Context,
    [string]$Registry,
    [string]$Tag,
    # Deployments to restart after applying: local ":dev" images can't signal a rebuild.
    [string[]]$Restart = @()
)

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
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

if ([bool]$Registry -ne [bool]$Tag) {
    Write-Host 'Give both -Registry and -Tag, or neither.' -ForegroundColor Red
    exit 1
}

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

if ($Registry) {
    # A throwaway overlay: the same base, with ECR image names. It sits next to the base
    # (Kustomize needs a relative path) in a gitignored folder, because the registry
    # name contains the AWS account ID.
    $overlay = "$Root\k8s\.overlay-aws"
    New-Item -ItemType Directory -Force $overlay | Out-Null
    @"
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../app
images:
  - name: rush-hour-register
    newName: $Registry/rush-hour/register
    newTag: "$Tag"
  - name: rush-hour-barista
    newName: $Registry/rush-hour/barista
    newTag: "$Tag"
"@ | Set-Content -Encoding utf8 (Join-Path $overlay 'kustomization.yaml')
    Invoke-Step "Deploying the shop (images $Tag from ECR)" { kubectl --context $Context apply -k $overlay }
    Remove-Item -Recurse -Force $overlay
} else {
    Invoke-Step 'Deploying the shop' { kubectl --context $Context apply -k "$Root\k8s\app" }
}
Invoke-Step 'Setting up the rush' { kubectl --context $Context apply -f "$Root\k8s\rush\setup.yaml" }

foreach ($service in $Restart) {
    Invoke-Step "Restarting $service with its new image" {
        kubectl --context $Context rollout restart "deployment/$service" -n rush-hour
    }
}

# Pods only read the settings when they start. Stamping a hash of the settings
# onto each Deployment makes Kubernetes roll them only when the settings change.
$configHash = (Get-FileHash "$Root\shop\config.json" -Algorithm SHA256).Hash.Substring(0, 16).ToLower()
$patchFile = Join-Path ([IO.Path]::GetTempPath()) 'rush-hour-config-patch.json'
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
