<#
.SYNOPSIS
    Builds the shop's images for ARM and pushes them to ECR, tagged with the git commit.
.DESCRIPTION
    ECR tags can't be overwritten, so each push gets a new tag: the short commit hash,
    plus a timestamp when there are uncommitted changes. aws-up.ps1 deploys the newest.
    Needs the AWS CLI signed in (aws login --profile rush-hour) and infra/live applied.
.EXAMPLE
    .\scripts\push-images.ps1
#>
[CmdletBinding()]
param(
    [string]$AwsProfile = 'rush-hour'
)

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
$env:AWS_PROFILE = $AwsProfile

function Invoke-Step {
    param([string]$What, [scriptblock]$Action)
    Write-Host "==> $What" -ForegroundColor Cyan
    & $Action
    if ($LASTEXITCODE -ne 0) { Write-Host "FAILED: $What" -ForegroundColor Red; exit 1 }
}

$repos = terraform "-chdir=$Root\infra\live" output -json ecr_repositories | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $repos) {
    Write-Host 'Could not read the ECR repositories. Is infra/live applied, and are you signed in?' -ForegroundColor Red
    exit 1
}
$registry = ($repos.register -split '/')[0]
$region = ($registry -split '\.')[3]

$tag = (git -C $Root rev-parse --short HEAD).Trim()
if (git -C $Root status --porcelain) { $tag = "$tag-dirty-$(Get-Date -Format 'yyyyMMddHHmmss')" }

# The login is piped straight into Docker; it never touches the screen or disk.
Invoke-Step 'Logging Docker in to ECR' {
    aws ecr get-login-password --region $region | docker login --username AWS --password-stdin $registry | Out-Null
}

foreach ($service in 'register', 'barista') {
    $image = "$($repos.$service):$tag"
    Invoke-Step "Building and pushing $service ($tag, linux/arm64)" {
        docker buildx build --platform linux/arm64 --provenance=false -t $image --push "$Root\services\$service"
    }
}

Write-Host ''
Write-Host "Pushed tag $tag. Deploy it with .\scripts\aws-up.ps1" -ForegroundColor Green
