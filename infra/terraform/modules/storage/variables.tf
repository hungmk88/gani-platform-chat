variable "platform" {
  description = "Implementation to use. Empty until Q2 picks a provider: nothing is created (infra/CLAUDE.md, Terraform)."
  type        = string
  default     = ""
  validation {
    condition     = var.platform == ""
    error_message = "No implementation of this module yet (waits for Q2)."
  }
}

variable "environment" {
  description = "staging or production: same module, different values only."
  type        = string
}

variable "cors_origins" {
  description = "Origins allowed to upload (widget, admin)"
  type        = list(string)
  default     = []
}
