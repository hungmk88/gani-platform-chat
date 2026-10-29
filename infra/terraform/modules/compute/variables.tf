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

variable "vcpu" {
  description = "vCPU of the application VM"
  type        = number
  default     = 4
}

variable "memory_gb" {
  description = "Memory of the application VM"
  type        = number
  default     = 8
}

variable "images" {
  description = "Image per service (gani-api, gani-worker, gani-admin): tag = git SHA, never latest"
  type        = map(string)
  default     = {}
}
