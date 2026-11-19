<#
.SYNOPSIS
    Starts the AWS demo server, connects kubectl to it, and deploys the shop.
.DESCRIPTION
    1. Starts the EC2 server (if it's stopped) and waits for SSM and k3s.
    2. Gets a short-lived (4-hour) token for a "rush-hour-operator" account on the
       cluster and adds a "rush-hour-aws" context to your kubeconfig. k3s's permanent
       admin certificate never leaves the server.
    3. Opens an SSM tunnel: 127.0.0.1:6443 on this laptop -> the server's Kubernetes
       API. No ports are open on the server; the tunnel runs over SSM.
    4. Deploys the shop with the newest images in ECR (scripts/deploy-shop.ps1).
    The server stops itself 4 hours after booting, or after an hour near idle.
    Stop it sooner with .\scripts\aws-down.ps1.
.EXAMPLE
    .\scripts\aws-up.ps1
.EXAMPLE
    .\scripts\aws-up.ps1 -NoDeploy    # just start and connect
#>
[CmdletBinding()]
param(
    [string]$AwsProfile = 'rush-hour',
    [int]$LocalPort = 6443,
    [switch]$NoDeploy
)

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
$env:AWS_PROFILE = $AwsProfile
$env:PYTHONUTF8 = '1' # The AWS CLI otherwise fails to print non-ASCII output on Windows.
$Context = 'rush-hour-aws'
$KubeDir = Join-Path $HOME '.kube'
$TunnelPidFile = Join-Path ([IO.Path]::GetTempPath()) 'rush-hour-aws-tunnel.pid'

function Fail([string]$Message) { Write-Host "FAILED: $Message" -ForegroundColor Red; exit 1 }
function Step([string]$What) { Write-Host "==> $What" -ForegroundColor Cyan }

if (-not (Get-Command session-manager-plugin -ErrorAction SilentlyContinue)) {
    Fail 'The Session Manager plugin is missing. Install it (winget install Amazon.SessionManagerPlugin) and open a new terminal.'
}

$out = terraform "-chdir=$Root\infra\live" output -json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $out.server_id) { Fail 'Could not read infra/live outputs. Is it applied, and are you signed in (aws login --profile rush-hour)?' }
$id = $out.server_id.value
$registry = ($out.ecr_repositories.value.register -split '/')[0]

# Runs shell commands on the server as root with SSM Run Command, and returns their
# output (or $null if they failed). Run Command keeps output in the account's SSM
# history, so nothing long-lived or secret goes through here. The request goes in a
# file, because Windows PowerShell 5.1 strips quotes from arguments to other programs.
function Invoke-Remote([string[]]$Commands) {
    $request = @{
        InstanceIds    = @($id)
        DocumentName   = 'AWS-RunShellScript'
        TimeoutSeconds = 60
        Parameters     = @{ commands = $Commands }
    } | ConvertTo-Json -Depth 4
    $file = Join-Path ([IO.Path]::GetTempPath()) "rush-hour-ssm-$PID.json"
    [IO.File]::WriteAllText($file, $request, (New-Object Text.UTF8Encoding($false)))
    $cid = aws ssm send-command --cli-input-json "file://$file" --query 'Command.CommandId' --output text 2>$null
    Remove-Item $file -ErrorAction SilentlyContinue
    if ($LASTEXITCODE -ne 0 -or -not $cid) { return $null }
    for ($i = 0; $i -lt 45; $i++) {
        Start-Sleep -Seconds 2
        $status = aws ssm get-command-invocation --command-id $cid --instance-id $id --query 'Status' --output text 2>$null
        if ($status -in 'Success', 'Failed', 'Cancelled', 'TimedOut') { break }
    }
    if ($status -ne 'Success') { return $null }
    $raw = aws ssm get-command-invocation --command-id $cid --instance-id $id --query 'StandardOutputContent' --output text
    return (($raw | ForEach-Object { $_ -replace "`r", '' }) -join "`n").Trim()
}

# ---------- 1. Start the server ----------
$state = aws ec2 describe-instances --instance-ids $id --query 'Reservations[0].Instances[0].State.Name' --output text
if ($state -ne 'running') {
    Step "Starting the server ($id, was $state)"
    if ($state -eq 'stopping') { aws ec2 wait instance-stopped --instance-ids $id }
    aws ec2 start-instances --instance-ids $id | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail 'start-instances' }
    aws ec2 wait instance-running --instance-ids $id
}

Step 'Waiting for the server to check in with SSM'
$deadline = (Get-Date).AddMinutes(6)
do {
    $ping = aws ssm describe-instance-information --filters "Key=InstanceIds,Values=$id" --query 'InstanceInformationList[0].PingStatus' --output text 2>$null
    if ($ping -eq 'Online') { break }
    Start-Sleep -Seconds 10
} while ((Get-Date) -lt $deadline)
if ($ping -ne 'Online') { Fail 'The server never checked in with SSM.' }

# The first boot installs k3s, which takes a few minutes.
Step 'Waiting for k3s'
$deadline = (Get-Date).AddMinutes(12)
do {
    $ready = Invoke-Remote @('k3s kubectl get --raw /readyz')
    if ($ready -match '\bok\b') { break }
    Start-Sleep -Seconds 15
} while ((Get-Date) -lt $deadline)
if ($ready -notmatch '\bok\b') { Fail 'k3s did not become ready. See /var/log/rush-hour-init.log on the server.' }

# ---------- 2. kubeconfig ----------
# A dedicated operator account on the cluster, and a token for it that expires in 4 hours
# (the server's own session cap). The cluster's CA certificate is public information:
# it only lets kubectl check it's talking to the real server.
Step "Adding the '$Context' context to your kubeconfig (a 4-hour token)"
$creds = Invoke-Remote @(
    'k3s kubectl -n kube-system create serviceaccount rush-hour-operator --dry-run=client -o yaml | k3s kubectl apply -f - >/dev/null',
    'k3s kubectl create clusterrolebinding rush-hour-operator --clusterrole=cluster-admin --serviceaccount=kube-system:rush-hour-operator --dry-run=client -o yaml | k3s kubectl apply -f - >/dev/null',
    'echo "CA=$(base64 -w0 /var/lib/rancher/k3s/server/tls/server-ca.crt)"',
    'echo "TOKEN=$(k3s kubectl -n kube-system create token rush-hour-operator --duration=4h)"'
)
$ca = ([regex]::Match("$creds", '(?m)^CA=(\S+)')).Groups[1].Value
$token = ([regex]::Match("$creds", '(?m)^TOKEN=(\S+)')).Groups[1].Value
if (-not $ca -or -not $token) { Fail 'Could not get cluster credentials from the server.' }
# No current-context: your default kubectl context stays what it was.
$kc = @"
apiVersion: v1
kind: Config
clusters:
- name: $Context
  cluster:
    server: https://127.0.0.1:$LocalPort
    certificate-authority-data: $ca
users:
- name: $Context
  user:
    token: $token
contexts:
- name: $Context
  context:
    cluster: $Context
    user: $Context
"@
Remove-Variable creds, token
New-Item -ItemType Directory -Force $KubeDir | Out-Null
$awsKube = Join-Path $KubeDir 'rush-hour-aws.yaml'
$utf8 = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText($awsKube, $kc, $utf8)
$mainKube = Join-Path $KubeDir 'config'
if (Test-Path $mainKube) { Copy-Item $mainKube "$mainKube.bak" -Force }
# The AWS file goes first, so its fresh credentials replace any old rush-hour-aws entries.
$env:KUBECONFIG = "$awsKube;$mainKube"
$merged = kubectl config view --flatten
Remove-Item Env:KUBECONFIG
if ($LASTEXITCODE -ne 0) { Fail 'Merging the kubeconfig' }
[IO.File]::WriteAllText($mainKube, ($merged -join "`n"), $utf8)
Remove-Item $awsKube

# ---------- 3. Tunnel ----------
if (Test-Path $TunnelPidFile) {
    Stop-Process -Id (Get-Content $TunnelPidFile) -ErrorAction SilentlyContinue
    Remove-Item $TunnelPidFile
}
Step "Opening the tunnel: 127.0.0.1:$LocalPort -> the server's Kubernetes API"
$tunnel = Start-Process -FilePath aws -WindowStyle Hidden -PassThru -ArgumentList @(
    'ssm', 'start-session', '--target', $id,
    '--document-name', 'AWS-StartPortForwardingSession',
    '--parameters', "portNumber=6443,localPortNumber=$LocalPort",
    '--profile', $AwsProfile
)
Set-Content $TunnelPidFile $tunnel.Id
$deadline = (Get-Date).AddSeconds(60)
do {
    Start-Sleep -Seconds 2
    $client = New-Object Net.Sockets.TcpClient
    try { $client.Connect('127.0.0.1', $LocalPort); $open = $true } catch { $open = $false } finally { $client.Dispose() }
} while (-not $open -and (Get-Date) -lt $deadline)
if (-not $open) { Fail 'The tunnel did not open.' }
kubectl --context $Context --request-timeout=20s get --raw /readyz | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'kubectl could not reach the server through the tunnel.' }

# ---------- 4. Deploy ----------
if (-not $NoDeploy) {
    $tag = aws ecr describe-images --repository-name rush-hour/register `
        --query 'sort_by(imageDetails,& imagePushedAt)[-1].imageTags[0]' --output text 2>$null
    if (-not $tag -or $tag -eq 'None') { Fail 'No images in ECR yet. Run .\scripts\push-images.ps1 first.' }
    & "$PSScriptRoot\deploy-shop.ps1" -Context $Context -Registry $registry -Tag $tag
    if ($LASTEXITCODE -ne 0) { exit 1 }
}

Write-Host ''
Write-Host 'Rush Hour is up on AWS.' -ForegroundColor Green
Write-Host "Send a rush:   .\scripts\rush.ps1 -Cluster $Context"
Write-Host "Open Grafana:  .\scripts\grafana.ps1 -Cluster $Context"
Write-Host 'Stop it:       .\scripts\aws-down.ps1   (it also stops itself: 4 hours after boot, or 1 hour idle)'
