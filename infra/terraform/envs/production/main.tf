# The production environment: the same eight modules as the other environment, only the values differ (infra/CLAUDE.md, Môi trường).
locals {
  environment = "production"
}

# platform = "" means no implementation is chosen yet. `validate` passes (CI), `plan` stops here with the reason, so nothing is
# planned or applied before Q2 (or the decision A/B). terraform_data is built into Terraform: no provider to download.
resource "terraform_data" "platform_chosen" {
  lifecycle {
    precondition {
      condition     = var.platform != ""
      error_message = "production: platform not set, cannot plan. No implementation chosen for any module (network, compute, database, cache, storage, dns_tls, secrets, monitoring): waits for Q2 or the decision A/B (docs/business/staging-options.md)."
    }
  }
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
