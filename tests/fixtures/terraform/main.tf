variable "greeting" {
  description = "Value echoed back through the output, so validate has something to check."
  type        = string
  default     = "hello"
}

locals {
  message = "${var.greeting} from actions-toolkit"
}

output "message" {
  description = "The composed greeting."
  value       = local.message
}
