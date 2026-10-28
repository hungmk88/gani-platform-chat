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

variable "secret_names" {
  description = "Names of the secrets (variables of .env.example); never their values"
  type        = list(string)
  default     = []
}
