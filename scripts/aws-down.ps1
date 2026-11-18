<#
.SYNOPSIS
    Closes the tunnel and stops the AWS demo server.
.DESCRIPTION
    Stopping keeps the server and its disk (about $1.60 a month for the disk); it just
    stops the hourly charge. Start it again with .\scripts\aws-up.ps1. To remove
    everything, see docs/aws.md (Tear down).
.EXAMPLE
    .\scripts\aws-down.ps1
#>
[CmdletBinding()]
param(
    [string]$AwsProfile = 'rush-hour'
)

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
$env:AWS_PROFILE = $AwsProfile
$TunnelPidFile = Join-Path ([IO.Path]::GetTempPath()) 'rush-hour-aws-tunnel.pid'

if (Test-Path $TunnelPidFile) {
    Write-Host '==> Closing the tunnel' -ForegroundColor Cyan
    Stop-Process -Id (Get-Content $TunnelPidFile) -ErrorAction SilentlyContinue
    Remove-Item $TunnelPidFile
}

$id = terraform "-chdir=$Root\infra\live" output -raw server_id
if ($LASTEXITCODE -ne 0 -or -not $id) {
    Write-Host 'Could not read the server ID. Are you signed in (aws login --profile rush-hour)?' -ForegroundColor Red
    exit 1
}

Write-Host "==> Stopping the server ($id)" -ForegroundColor Cyan
aws ec2 stop-instances --instance-ids $id | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host 'FAILED: stop-instances' -ForegroundColor Red; exit 1 }
aws ec2 wait instance-stopped --instance-ids $id
Write-Host 'Stopped. No hourly charges until the next .\scripts\aws-up.ps1.' -ForegroundColor Green
