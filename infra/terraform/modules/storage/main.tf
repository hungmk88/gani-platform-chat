# Interface of the storage module: Bucket per environment, lifecycle, CORS for widget uploads; objects under /{org_id}/{workspace_id}/ (Brief P5).
# Environments call this module only, never a provider's resources. Implementations go in modules/storage/<provider>/, one module
# call each with count = var.platform == "<provider>" ? 1 : 0, outputs merged with one(...) (modules/database shows how).
# Implementation directories (e.g. one per provider) will be created when Q2 is answered.
# Do NOT create provider-named directories before Q2.
