variable "region" {
  description = "AWS region for everything. us-east-1 is cheapest, and CloudFront certificates must live there."
  type        = string
  default     = "us-east-1"
}

variable "budget_email" {
  description = "Where budget alerts go. Set in terraform.tfvars (gitignored), never in the repo."
  type        = string
  sensitive   = true
}

variable "monthly_limit_usd" {
  description = "The hard monthly maximum from CLAUDE.md."
  type        = number
  default     = 30
}

variable "alert_thresholds_usd" {
  description = "Actual spend, in dollars, that triggers an email."
  type        = list(number)
  default     = [1, 5, 20, 30]
}
