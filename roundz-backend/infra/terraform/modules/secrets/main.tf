variable "name" {
  type        = string
  description = "Logical name for the secrets module."
}

variable "tags" {
  type        = map(string)
  description = "Common resource tags or labels."
  default     = {}
}

output "module_name" {
  value = var.name
}
