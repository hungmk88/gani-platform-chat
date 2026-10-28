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

variable "cidr_block" {
  description = "Address range of the private network"
  type        = string
  default     = "10.20.0.0/16"
}

variable "ingress_ports" {
  description = "Ports the load balancer opens to the internet (TLS only)"
  type        = list(number)
  default     = [443]
}
