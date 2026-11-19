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

# A throwaway Docker config just for this push. Windows Credential Manager can't store ECR
# logins (they're too long: "The stub received bad data"), so the login is kept in this
# folder instead, and the folder is deleted when the push ends. Your own Docker settings
# aren't touched, and the login expires after 12 hours anyway.
#
# The login goes straight into that config file (no "docker login"): Docker on Windows
# falls back to Credential Manager whenever its config holds no logins, and piping the
# token through Windows PowerShell 5.1 corrupts it. The token never touches the screen.
$dockerConfig = Join-Path ([IO.Path]::GetTempPath()) "rush-hour-docker-$PID"
New-Item -ItemType Directory -Force $dockerConfig | Out-Null
$failed = $null
try {
    Write-Host '==> Logging Docker in to ECR' -ForegroundColor Cyan
    $token = aws ecr get-login-password --region $region
    if ($LASTEXITCODE -ne 0 -or -not $token) { $failed = 'getting an ECR login' }
    else {
        $auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("AWS:$($token.Trim())"))
        $config = @{ auths = @{ $registry = @{ auth = $auth } } } | ConvertTo-Json -Depth 4
        [IO.File]::WriteAllText((Join-Path $dockerConfig 'config.json'), $config)
        $env:DOCKER_CONFIG = $dockerConfig
    }
    Remove-Variable token, auth, config -ErrorAction SilentlyContinue

    foreach ($service in 'register', 'barista') {
        if ($failed) { break }
        $image = "$($repos.$service):$tag"
        Write-Host "==> Building and pushing $service ($tag, linux/arm64)" -ForegroundColor Cyan
        docker buildx build --platform linux/arm64 --provenance=false -t $image --push "$Root\services\$service"
        if ($LASTEXITCODE -ne 0) { $failed = "pushing $service" }
    }
} finally {
    Remove-Item Env:DOCKER_CONFIG -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force $dockerConfig -ErrorAction SilentlyContinue
}
if ($failed) { Write-Host "FAILED: $failed" -ForegroundColor Red; exit 1 }

Write-Host ''
Write-Host "Pushed tag $tag. Deploy it with .\scripts\aws-up.ps1" -ForegroundColor Green
