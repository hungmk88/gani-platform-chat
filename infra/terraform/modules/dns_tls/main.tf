# Interface of the dns_tls module: Domain records and TLS certificates.
# Environments call this module only, never a provider's resources. Implementations go in modules/dns_tls/<provider>/, one module
# call each with count = var.platform == "<provider>" ? 1 : 0, outputs merged with one(...) (modules/database shows how).
# Implementation directories (e.g. one per provider) will be created when Q2 is answered.
# Do NOT create provider-named directories before Q2.
