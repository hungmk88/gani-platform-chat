# FPT Cloud implementation of this module: a placeholder on purpose, not unfinished work (N203).
# Q2 chose FPT Cloud (01/11/2026), but the provider is not verified yet: registry.terraform.io was not reachable from the
# session that wrote this (06/11/2026), and no provider name is written from memory.
# Until N203 is closed:
#   - do NOT add required_providers to envs/*/versions.tf;
#   - do NOT commit .terraform.lock.hcl;
#   - do NOT set platform = "fpt" in envs/* (the modules' validation refuses it, and plan would run empty: a false green).
# Closing N203 = a provider name and version checked against the registry + .terraform.lock.hcl from a real `terraform init`.
# This directory is called from nowhere (no module block, no count) until then.
