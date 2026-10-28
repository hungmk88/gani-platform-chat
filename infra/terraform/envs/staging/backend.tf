# Remote state: not configured until Q2 (the state lives with the chosen cloud, encrypted, with a lock). Until then the only
# commands are `init -backend=false` and `validate`. Shapes to start from once Q2 is answered (examples, not choices):
#   terraform { backend "s3" { bucket = "<state bucket>", key = "<env>/terraform.tfstate", region = "<region>",
#                              encrypt = true, dynamodb_table = "<lock table>" } }
#   terraform { backend "gcs" { bucket = "<state bucket>", prefix = "<env>" } }   # GCS locks the state itself
