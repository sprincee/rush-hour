# Rush Hour on AWS: runbook

Players get the game and recorded real runs from a static site. The real cluster is one
EC2 server the owner starts for demos. Nothing public reaches it. Decisions: CLAUDE.md
(Hosting, Guardrails). Costs: about $2-2.50 a month with ~10 demo hours.

Everything is in `infra/`, in two Terraform stacks:

| Stack | What | State |
|---|---|---|
| `infra/bootstrap` | Budget alerts, and the S3 bucket for the main stack's state | Local file (gitignored) |
| `infra/live` | Site (S3 + CloudFront), ECR, network, the EC2 server, auto-stop | In the bootstrap bucket |

## One-time setup

The AWS account is shared with other projects, so Rush Hour gets its own identity and a
budget that only counts resources tagged `Project = rush-hour`.

### 1. Create the deploy identity (AWS console, signed in as an admin)

1. IAM → Users → **Create user** `rush-hour-admin`. Tick **Provide user access to the
   AWS Management Console** (the CLI's `aws login` uses console credentials).
2. Permissions: **Attach policies directly** → `PowerUserAccess` (everything except IAM).
3. After creating it: the user → Permissions → Add permissions → **Create inline policy**
   → JSON → paste `infra/bootstrap/rush-hour-admin-policy.json`. Name it
   `rush-hour-iam`. It lets this user manage only IAM roles named `rush-hour-*`, attach
   only the two AWS policies the server needs, and pass roles only to EC2.
4. The user → Security credentials → **Assign MFA device**.

### 2. Sign the CLI in

```powershell
aws login --profile rush-hour     # opens the browser; region us-east-1
aws sts get-caller-identity --profile rush-hour
$env:AWS_PROFILE = 'rush-hour'    # for this terminal
```

### 3. Create the bootstrap stack

```powershell
cd infra\bootstrap
copy terraform.tfvars.example terraform.tfvars   # then set budget_email
terraform init
terraform plan
terraform apply
```

### 4. Turn on cost tracking for the tag

Billing and Cost Management → **Cost allocation tags** → User-defined → select
`Project` → **Activate**. The tag appears there only after AWS has seen it on a resource
(the state bucket), which can take up to 24 hours. Until it's active, the budget reads
$0, so **don't create `infra/live` before this is done.**

When the other projects are gone from the account, the budget can drop its tag filter
and count the whole account.

### 5. Create the main stack (after step 4)

```powershell
cd infra\live
copy backend.hcl.example backend.hcl    # bucket = infra/bootstrap's state_bucket output
terraform init -backend-config=backend.hcl
terraform plan -out live.tfplan
terraform apply live.tfplan
```

Applying creates the server **running**: its first boot installs k3s. It stops itself
(see below), or run `.\scripts\aws-down.ps1` when it's done.

## Day to day

All scripts default to the `rush-hour` profile; sign in first with `aws login --profile rush-hour`.

| Do | Command | Notes |
|---|---|---|
| Publish the site | `.\scripts\deploy-site.ps1` | Builds `dist/`, uploads it, clears CloudFront's cache |
| Push new shop images | `.\scripts\push-images.ps1` | ARM builds, tagged with the git commit |
| Start a demo | `.\scripts\aws-up.ps1` | Starts the server, adds the `rush-hour-aws` kubectl context, opens the SSM tunnel, deploys the newest images |
| Send a rush | `.\scripts\rush.ps1 -Cluster rush-hour-aws` | Same options as locally |
| Grafana | `.\scripts\grafana.ps1 -Cluster rush-hour-aws` | Through the same tunnel |
| A shell on the server | `aws ssm start-session --target <server_id>` | `terraform output server_id`; no SSH |
| Stop | `.\scripts\aws-down.ps1` | Closes the tunnel, stops the server |

**Auto-stop.** The server stops itself two ways, so a forgotten demo costs cents:
1. It powers off 4 hours after booting (a systemd timer on the server).
2. CloudWatch stops it after 60 minutes under 10% CPU.

Stopped, it costs only its disk (~$1.60 a month). `aws-up.ps1` starts it again.

**Security.** Nothing on the internet can connect to the server: its security group has
no inbound rules, and you reach it through SSM (shell and tunnels), signed in as
`rush-hour-admin`. It allows outbound 80/443 only. Its IAM role can only use SSM and
pull from ECR. IMDSv2 is required, the disk is encrypted, and k3s encrypts Secrets.

## Tear down

`infra/live`: `terraform destroy`. The bootstrap stack stays (budgets are free, and the
state bucket costs pennies). Its bucket has `prevent_destroy`; remove that line first if
you ever want it gone.
