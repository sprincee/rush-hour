# A small VPC with one public subnet and no NAT gateway (NAT costs ~$32 a month).
# The server gets a public IP only so it can reach out (OS packages, k3s, images, SSM);
# its security group allows nothing in.

data "aws_ec2_instance_type_offerings" "server" {
  location_type = "availability-zone"
  filter {
    name   = "instance-type"
    values = [var.instance_type]
  }
}

locals {
  # The first zone (alphabetically) that offers the instance type.
  az = sort(data.aws_ec2_instance_type_offerings.server.locations)[0]
}

resource "aws_vpc" "main" {
  cidr_block           = "10.20.0.0/24"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "rush-hour" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "rush-hour" }
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.20.0.0/25"
  availability_zone       = local.az
  map_public_ip_on_launch = true # Auto-assigned: billed only while the server runs, unlike an Elastic IP.
  tags                    = { Name = "rush-hour-public" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "rush-hour-public" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# Take every rule off the VPC's default security group, so nothing can use it by accident.
resource "aws_default_security_group" "default" {
  vpc_id = aws_vpc.main.id
}

resource "aws_security_group" "server" {
  name        = "rush-hour-server"
  description = "Rush Hour server: no inbound at all; outbound web only"
  vpc_id      = aws_vpc.main.id
  # No ingress blocks: nothing on the internet can connect. Access is through SSM,
  # which the server reaches out to.
  egress {
    description = "HTTPS: SSM, ECR, S3, k3s, container images, OS packages"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    description = "HTTP: some OS package mirrors"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "rush-hour-server" }
}
