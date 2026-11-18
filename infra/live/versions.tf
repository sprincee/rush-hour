# The main stack: the public site, the image registry, and the demo server.
# State lives in the bucket that infra/bootstrap created, with S3-native locking.

terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0" # Exact version pinned in .terraform.lock.hcl (committed).
    }
  }

  # The bucket name includes the AWS account ID, which stays out of the public repo:
  # it's in backend.hcl (gitignored). Set up with:
  #   copy backend.hcl.example backend.hcl   (then fill in the bucket from infra/bootstrap)
  #   terraform init -backend-config=backend.hcl
  backend "s3" {
    key          = "live/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true # A lock file next to the state stops two applies at once.
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "rush-hour" # The budget only counts resources with this tag.
      ManagedBy = "terraform"
      Stack     = "live"
    }
  }
}

data "aws_caller_identity" "current" {}
