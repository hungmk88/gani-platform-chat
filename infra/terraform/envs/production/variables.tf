variable "platform" {
  description = "Implementation of every module for this environment; empty until Q2 or the decision A/B (docs/business/staging-options.md)."
  type        = string
  default     = ""
}

variable "domain" {
  description = "Public domain of this environment"
  type        = string
  default     = "example.invalid"
}
