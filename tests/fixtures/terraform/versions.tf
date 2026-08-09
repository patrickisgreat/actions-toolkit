# Fixture for self-CI: a provider-free root that `terraform init -backend=false` and
# `terraform validate` can process on a runner with no cloud credentials.
terraform {
  required_version = ">= 1.5.0"
}
