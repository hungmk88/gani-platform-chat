# Interface of the compute module: VM or instance group for api, worker, ai-gateway (Brief P5: Đợt 1 one 4 vCPU/8 GB VM; staging 2 vCPU/4 GB).
# Environments call this module only, never a provider's resources. Implementations go in modules/compute/<provider>/, one module
# call each with count = var.platform == "<provider>" ? 1 : 0, outputs merged with one(...) (modules/database shows how).
# Implementation directories (e.g. one per provider) will be created when Q2 is answered.
# Do NOT create provider-named directories before Q2.
