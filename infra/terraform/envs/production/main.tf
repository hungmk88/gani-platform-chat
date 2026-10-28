# The production environment: the same eight modules as the other environment, only the values differ (infra/CLAUDE.md, Môi trường).
locals {
  environment = "production"
}

module "network" {
  source      = "../../modules/network"
  platform    = var.platform
  environment = local.environment
}

module "compute" {
  source      = "../../modules/compute"
  platform    = var.platform
  environment = local.environment
  vcpu        = 4
  memory_gb   = 8
}

module "database" {
  source      = "../../modules/database"
  platform    = var.platform
  environment = local.environment
}

module "cache" {
  source      = "../../modules/cache"
  platform    = var.platform
  environment = local.environment
}

module "storage" {
  source      = "../../modules/storage"
  platform    = var.platform
  environment = local.environment
}

module "dns_tls" {
  source      = "../../modules/dns_tls"
  platform    = var.platform
  environment = local.environment
  domain      = var.domain
}

module "secrets" {
  source      = "../../modules/secrets"
  platform    = var.platform
  environment = local.environment
}

module "monitoring" {
  source      = "../../modules/monitoring"
  platform    = var.platform
  environment = local.environment
}
