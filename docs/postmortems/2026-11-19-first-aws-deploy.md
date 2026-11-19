# First AWS deploy: four things that broke on the way

**Date:** 2026-11-19
**Impact:** The first deploy to AWS took four fixes. No users affected; nothing public reached the cluster. Cost: a few cents of server time.

## What happened
Running the new stack for the first time (`infra/live`, then `push-images.ps1`, `deploy-site.ps1`, `aws-up.ps1`), four steps failed in turn.

1. **The server was refused.** `terraform apply` created 22 of 24 resources, then EC2 answered: *"The specified instance type is not eligible for Free Tier."*
2. **Docker couldn't log in to ECR** ("400 Bad Request").
3. **Docker couldn't save the ECR login** (*"The stub received bad data"*).
4. **`aws-up.ps1` hung at "Waiting for k3s"** for 10 minutes, though the server was healthy.

## Cause
1. **The AWS account was on the Free plan** (introduced mid-2025). It only allows a short list of instance types (2 GiB at most on ARM), and the plan was due to end on 2026-12-15, after which AWS closes the account unless it's upgraded. Nothing in the design had checked the account's plan.
2. **Windows PowerShell 5.1 re-encodes text piped between programs** and adds a line ending, so the token reached `docker login` corrupted.
3. **Docker on Windows stores logins in Windows Credential Manager,** which can't hold an ECR token (too long). It falls back to Credential Manager whenever its config file holds no logins, even in a separate config folder.
4. **`aws ssm start-session` with an interactive command needs a terminal.** Run from a script that captures its output, it just waits. The local tests couldn't catch this, because they never talked to a real server.

## Fix
1. The owner upgraded the account to the paid plan (the upgrade itself is free; the remaining credits stayed). Terraform then created only the 2 missing pieces.
2. and 3. `push-images.ps1` no longer runs `docker login`. It asks AWS for the token in memory, writes it into a throwaway Docker config folder (`DOCKER_CONFIG`), pushes, and deletes the folder, even on failure.
4. `aws-up.ps1` runs remote commands with **SSM Run Command** instead, sending the request as a file (PowerShell 5.1 strips quotes from arguments). This also changed the credentials design for the better: instead of copying k3s's permanent admin certificate to the laptop, the server issues a **4-hour token** for a `rush-hour-operator` account. Run Command keeps output in the account's SSM history, so only something short-lived passes through it. The admin certificate never leaves the server.

## Takeaways
- Check the account, not just the design: plan type, quotas, and eligible instance types belong in the pre-flight list.
- Scripts written for Windows PowerShell 5.1 need testing against real programs: piping text between programs and passing quoted arguments both behave differently from other shells.
- Short-lived credentials beat copying long-lived ones, even over a private channel.
- After the fixes, the whole path worked end to end: the site live on CloudFront, images from ECR, a 50-order rush on the server with 0 failures, and Prometheus counting exactly 50 orders.
