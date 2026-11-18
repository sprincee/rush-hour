# The bootstrap stack: what has to exist before anything else.
#   1. Budget alerts, so spending is watched before anything costs money.
#   2. The S3 bucket that holds the main stack's Terraform state.
# It keeps its own state on this laptop (terraform.tfstate, gitignored), because the
# bucket it would store state in is the thing it creates.

terraform {
  required_version = ">= 1.10" # S3 state locking without DynamoDB (use_lockfile) needs 1.10+.

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0" # The exact version is pinned in .terraform.lock.hcl (committed).
    }
  }
}

provider "aws" {
  region = var.region

  # Every resource gets these tags, so the bill can be filtered by project.
  default_tags {
    tags = {
      Project   = "rush-hour"
      ManagedBy = "terraform"
      Stack     = "bootstrap"
    }
  }
}
