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

variable "memory_mb" {
  description = "Memory (Brief P5: 1 GB in Đợt 1)"
  type        = number
  default     = 1024
}

variable "append_only" {
  description = "AOF on: BullMQ jobs survive a restart"
  type        = bool
  default     = true
}
