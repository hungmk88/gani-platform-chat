# This is a placeholder implementation for testing the platform selector. Replace with real implementation when Q2 answers.
# Do NOT use in production. No provider, no resource.
variable "environment" {
  type = string
}

variable "postgres_version" {
  type = string
}

output "endpoint" {
  value = "dummy-temp-pg${var.postgres_version}.${var.environment}.invalid:5432"
}
