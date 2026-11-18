output "state_bucket" {
  description = "Put this in infra/live's backend settings."
  value       = aws_s3_bucket.state.bucket
}

output "region" {
  value = var.region
}
