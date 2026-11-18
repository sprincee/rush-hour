<#
.SYNOPSIS
    Builds the lesson site and publishes it to S3 behind CloudFront.
.DESCRIPTION
    Builds dist/ with lessons/build.py, uploads it (deleting files that are gone),
    gives the game's .mjs modules the JavaScript content type browsers require, and
    clears CloudFront's cache so players get the new version.
.EXAMPLE
    .\scripts\deploy-site.ps1
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

$out = terraform "-chdir=$Root\infra\live" output -json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $out.site_bucket) {
    Write-Host 'Could not read the site settings. Is infra/live applied, and are you signed in?' -ForegroundColor Red
    exit 1
}
$bucket = "s3://$($out.site_bucket.value)"

Invoke-Step 'Building the site' { & "$Root\.venv\Scripts\python.exe" "$Root\lessons\build.py" }

# Pages and modules change with every deploy; fonts and data rarely do.
Invoke-Step 'Uploading pages and assets' {
    aws s3 sync "$Root\dist" $bucket --delete --exclude '*.mjs' --cache-control 'public, max-age=300' --only-show-errors
}
# Browsers refuse to run modules unless they're served as JavaScript.
Invoke-Step 'Uploading the game modules' {
    aws s3 sync "$Root\dist" $bucket --exclude '*' --include '*.mjs' --content-type 'text/javascript' --cache-control 'public, max-age=300' --only-show-errors
}
# One path ("/*") counts as one of CloudFront's 1,000 free invalidations a month.
Invoke-Step 'Clearing the CloudFront cache' {
    aws cloudfront create-invalidation --distribution-id $out.distribution_id.value --paths '/*' --query 'Invalidation.Status' --output text
}

Write-Host ''
Write-Host "Live in a minute or two: $($out.site_url.value)" -ForegroundColor Green
