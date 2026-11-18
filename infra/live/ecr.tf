# Private image registry for the shop's two services. The server pulls with its IAM
# role (no stored passwords). Tags can't be overwritten, every push is scanned for known
# vulnerabilities (basic scanning is free), and only the last 3 images are kept.

locals {
  services = ["register", "barista"]
}

resource "aws_ecr_repository" "service" {
  for_each             = toset(local.services)
  name                 = "rush-hour/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true # Images are rebuildable from the repo.

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "service" {
  for_each   = aws_ecr_repository.service
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 3 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 3 }
      action       = { type = "expire" }
    }]
  })
}
