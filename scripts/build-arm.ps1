<#
.SYNOPSIS
    Builds the shop's images for ARM (linux/arm64), the processor in AWS t4g servers,
    and checks each one starts and loads its dependencies.
.DESCRIPTION
    On an Intel or AMD laptop, Docker emulates ARM for this, so it's slower than a
    normal build. The images are tagged rush-hour-<service>:arm64. Pushing them to a
    registry comes with the AWS setup (roadmap step 4).
.EXAMPLE
    .\scripts\build-arm.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot

foreach ($service in 'register', 'barista') {
    $image = "rush-hour-${service}:arm64"
    Write-Host "==> Building $image" -ForegroundColor Cyan
    docker build -q --provenance=false --platform linux/arm64 -t $image "$Root\services\$service" | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Host "FAILED: building $service" -ForegroundColor Red; exit 1 }

    $arch = docker run --rm --platform linux/arm64 $image python -c "import platform, redis, prometheus_client; print(platform.machine())"
    if ($LASTEXITCODE -ne 0 -or $arch -ne 'aarch64') {
        Write-Host "FAILED: $image didn't start as ARM (got '$arch')" -ForegroundColor Red
        exit 1
    }
    Write-Host "    $image runs on $arch" -ForegroundColor Green
}
