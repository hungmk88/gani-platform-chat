# Interface of the database module: PostgreSQL 16 managed, PITR, replica later, extensions vector/pg_trgm/unaccent (Brief P5).
# Environments call this module only. Each implementation is a child module called with count = 1 when `platform` names it,
# 0 otherwise; outputs.tf merges them with one(...), which gives null when no implementation is selected.
# dummy_a and dummy_temp create nothing: they prove the switch (tests/platform.tftest.hcl) and are removed when the first real
# implementation lands. Implementation directories (e.g. one per provider) will be created when Q2 is answered.
# Do NOT create provider-named directories before Q2.

module "dummy_a" {
  source           = "./dummy_a"
  count            = var.platform == "dummy_a" ? 1 : 0
  environment      = var.environment
  postgres_version = var.postgres_version
}

module "dummy_temp" {
  source           = "./dummy_temp"
  count            = var.platform == "dummy_temp" ? 1 : 0
  environment      = var.environment
  postgres_version = var.postgres_version
}
