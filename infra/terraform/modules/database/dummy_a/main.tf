# Test double of an implementation: no provider, no resource. Removed when the first real implementation lands.
variable "environment" {
  type = string
}

variable "postgres_version" {
  type = string
}

output "endpoint" {
  value = "dummy-a-pg${var.postgres_version}.${var.environment}.invalid:5432"
}
