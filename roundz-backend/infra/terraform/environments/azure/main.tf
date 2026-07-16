terraform {
  required_version = ">= 1.6.0"
}

variable "environment" {
  type    = string
  default = "azure"
}

locals {
  common_tags = {
    project     = "roundz"
    environment = var.environment
  }
}

module "network" {
  source = "../../modules/network"
  name   = "roundz-${var.environment}-network"
  tags   = local.common_tags
}
