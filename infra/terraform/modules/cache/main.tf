# Interface of the cache module: Redis-compatible cache with AOF (Valkey 8.0 in dev and CI, N40).
# Environments call this module only, never a provider's resources. Implementations go in modules/cache/<provider>/, one module
# call each with count = var.platform == "<provider>" ? 1 : 0, outputs merged with one(...) (modules/database shows how).
# Implementation directories (e.g. one per provider) will be created when Q2 is answered.
# Do NOT create provider-named directories before Q2.
