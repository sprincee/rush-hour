variable "region" {
  type    = string
  default = "us-east-1"
}

variable "instance_type" {
  description = "Measured 2026-11-17: 2.45 GiB peak on one node, so 4 GiB (t4g.medium) fits; 2 GiB doesn't."
  type        = string
  default     = "t4g.medium"
}

variable "root_volume_gb" {
  description = "Disk for the OS, k3s, and images. Billed even while the server is stopped (about $0.08 per GB a month)."
  type        = number
  default     = 20
}

variable "k3s_version" {
  description = "The same k3s version as the local clusters (k8s/k3d-cluster.yaml uses v1.35.5-k3s1)."
  type        = string
  default     = "v1.35.5+k3s1"
}

variable "max_session_hours" {
  description = "Hard cap: the server powers itself off this long after booting, whatever it's doing."
  type        = number
  default     = 4
}

variable "idle_cpu_percent" {
  description = "Below this average CPU for the idle window, CloudWatch stops the server."
  type        = number
  default     = 10
}

variable "idle_minutes" {
  description = "How long the server must sit near idle before CloudWatch stops it."
  type        = number
  default     = 60
}
