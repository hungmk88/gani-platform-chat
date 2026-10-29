# Interface of the secrets module: Secret manager and KMS key; the apps read secrets at start-up, channel tokens use envelope encryption.
# Environments call this module only, never a provider's resources. Implementations go in modules/secrets/<provider>/, one module
# call each with count = var.platform == "<provider>" ? 1 : 0, outputs merged with one(...) (modules/database shows how).
# Implementation directories (e.g. one per provider) will be created when Q2 is answered.
# Do NOT create provider-named directories before Q2.
