# Interface of the monitoring module: Alert rules, dashboards, uptime checks (thresholds: Brief P19, single source).
# Environments call this module only, never a provider's resources. Implementations go in modules/monitoring/<provider>/, one module
# call each with count = var.platform == "<provider>" ? 1 : 0, outputs merged with one(...) (modules/database shows how).
# Implementation directories (e.g. one per provider) will be created when Q2 is answered.
# Do NOT create provider-named directories before Q2.
