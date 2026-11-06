# Interface of the network module: VPC/subnet, security group, load balancer (Brief P5).
# Environments call this module only, never a provider's resources. Implementations go in modules/network/<provider>/, one module
# call each with count = var.platform == "<provider>" ? 1 : 0, outputs merged with one(...) (modules/database shows how).
# Implementation directories (e.g. one per provider) will be created when Q2 is answered.
# Q2 chose FPT (01/11/2026); fpt/ is a skeleton waiting for the provider to be verified (N203), called from nowhere yet.
