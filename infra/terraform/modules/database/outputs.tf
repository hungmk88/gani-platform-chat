output "endpoint" {
  description = "host:port for DATABASE_URL_*; null when no implementation is selected"
  value       = one(concat(module.dummy_a[*].endpoint, module.dummy_temp[*].endpoint))
}
