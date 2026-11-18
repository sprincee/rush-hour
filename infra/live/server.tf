# The demo server: one t4g.medium running k3s. The owner starts it for demos
# (scripts/aws-up.ps1); two guards stop it again:
#   1. On the server: it powers itself off max_session_hours after booting.
#   2. CloudWatch: it's stopped after idle_minutes below idle_cpu_percent CPU.
# Powering off stops the instance (it isn't deleted), so the disk and setup survive.

# ---------- Its identity ----------
resource "aws_iam_role" "server" {
  name = "rush-hour-server" # rush-hour-admin may only manage roles named rush-hour-*.
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

# Session Manager: shell and port forwarding without SSH or open ports.
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.server.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# Pull the shop's images from ECR (read-only).
resource "aws_iam_role_policy_attachment" "ecr" {
  role       = aws_iam_role.server.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_iam_instance_profile" "server" {
  name = "rush-hour-server"
  role = aws_iam_role.server.name
}

# ---------- The machine ----------
# The latest Amazon Linux 2023 for ARM, looked up when the server is first created.
data "aws_ssm_parameter" "al2023_arm" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

resource "aws_instance" "server" {
  ami                    = data.aws_ssm_parameter.al2023_arm.value
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.server.id]
  iam_instance_profile   = aws_iam_instance_profile.server.name

  # "poweroff" on the server stops the instance instead of deleting it.
  instance_initiated_shutdown_behavior = "stop"

  # t4g servers can bill extra for running hot for long ("unlimited" credits).
  # Standard mode never does; the CPU just slows down if credits run out.
  credit_specification {
    cpu_credits = "standard"
  }

  # IMDSv2 only: the instance's credentials need a session token, which blocks a
  # common class of server-side request forgery attacks.
  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = var.root_volume_gb
    encrypted   = true
    tags        = { Name = "rush-hour-server", Project = "rush-hour" }
  }

  user_data = templatefile("${path.module}/server-init.sh.tftpl", {
    k3s_version       = var.k3s_version
    region            = var.region
    registry          = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.region}.amazonaws.com"
    max_session_hours = var.max_session_hours
  })

  lifecycle {
    # A newer Amazon Linux image shouldn't rebuild a working server. Changing
    # user_data does (Terraform replaces the instance), which is intended.
    ignore_changes = [ami]
  }

  tags = { Name = "rush-hour-server" }
}

# ---------- Guard 2: stop when idle ----------
resource "aws_cloudwatch_metric_alarm" "idle_stop" {
  alarm_name          = "rush-hour-server-idle-stop"
  alarm_description   = "Stops the Rush Hour server after ${var.idle_minutes} minutes below ${var.idle_cpu_percent}% CPU."
  namespace           = "AWS/EC2"
  metric_name         = "CPUUtilization"
  dimensions          = { InstanceId = aws_instance.server.id }
  statistic           = "Average"
  period              = 300 # Basic EC2 metrics come every 5 minutes, free.
  evaluation_periods  = var.idle_minutes / 5
  threshold           = var.idle_cpu_percent
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "notBreaching" # A stopped server sends no data; leave it alone.
  alarm_actions       = ["arn:aws:automate:${var.region}:ec2:stop"]
}
