<#
.SYNOPSIS
    Opens a private tunnel to Grafana and copies the admin password to the clipboard.
.EXAMPLE
    .\scripts\grafana.ps1
.EXAMPLE
    .\scripts\grafana.ps1 -Cluster rush-hour-aws    # the AWS server, after aws-up.ps1
#>
[CmdletBinding()]
param(
    [ValidateSet('rush-hour', 'rush-hour-single', 'rush-hour-aws')][string]$Cluster = 'rush-hour'
)

$Context = if ($Cluster -eq 'rush-hour-aws') { $Cluster } else { "k3d-$Cluster" }

$encoded = kubectl --context $Context --request-timeout=20s get secret grafana-admin -n monitoring -o 'jsonpath={.data.admin-password}'
if ($LASTEXITCODE -ne 0 -or -not $encoded) {
    Write-Host 'Could not read the Grafana password. Has .\scripts\up.ps1 been run?' -ForegroundColor Red
    exit 1
}
[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded)) | Set-Clipboard

Write-Host 'Grafana: http://127.0.0.1:3000' -ForegroundColor Green
Write-Host 'Username: admin. The password is on your clipboard.'
Write-Host 'Press Ctrl+C to stop.'
kubectl --context $Context port-forward -n monitoring svc/monitoring-grafana 3000:80
