output "site_url" {
  description = "The public site."
  value       = "https://${aws_cloudfront_distribution.site.domain_name}"
}

output "site_bucket" {
  value = aws_s3_bucket.site.bucket
}

output "distribution_id" {
  description = "For cache invalidation after a deploy."
  value       = aws_cloudfront_distribution.site.id
}

output "ecr_repositories" {
  value = { for k, r in aws_ecr_repository.service : k => r.repository_url }
}

output "server_id" {
  description = "For aws ec2 start-instances / stop-instances and SSM sessions."
  value       = aws_instance.server.id
}
