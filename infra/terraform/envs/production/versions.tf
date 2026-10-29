# Same file in envs/staging and envs/production (copied, not a symlink). CI runs exactly the version of
# infra/terraform/.terraform-version (1.16.6, checksums in infra/terraform/terraform.sha256); a newer 1.x works on a dev machine.
# Upgrade policy: after a version has been stable for >= 4 weeks and CI has run on it without issues for >= 1 week.
# Providers: none until Q2. Add each one here with an exact version, then commit .terraform.lock.hcl.
terraform {
  required_version = ">= 1.16.6, < 2.0.0"
}
