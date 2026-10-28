variable "platform" {
  description = "Implementation to use. Empty until Q2 picks a provider: nothing is created (infra/CLAUDE.md, Terraform)."
  type        = string
  default     = ""
  validation {
    condition     = contains(["", "dummy_a", "dummy_temp"], var.platform)
    error_message = "Unknown platform: use \"\" (none yet), \"dummy_a\" or \"dummy_temp\"."
  }
}

variable "environment" {
  description = "staging or production: same module, different values only."
  type        = string
}

variable "postgres_version" {
  description = "Major version of PostgreSQL (16, as dev and CI)"
  type        = string
  default     = "16"
}

variable "extensions" {
  description = "Extensions the migrations need"
  type        = list(string)
  default     = ["vector", "pg_trgm", "unaccent"]
}

variable "pitr_enabled" {
  description = "Point-in-time recovery: RPO <= 1 hour, RTO <= 4 hours (Phụ lục v2.3 §22)"
  type        = bool
  default     = true
}
