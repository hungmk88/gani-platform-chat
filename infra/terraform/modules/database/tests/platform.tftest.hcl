# The platform switch of the interface: each value selects exactly one implementation, "" selects none, anything else fails.
variables {
  environment = "staging"
}

run "dummy_a" {
  command = plan
  variables {
    platform = "dummy_a"
  }
  assert {
    condition     = output.endpoint == "dummy-a-pg16.staging.invalid:5432"
    error_message = "platform = dummy_a must give the endpoint of dummy_a"
  }
}

run "dummy_temp" {
  command = plan
  variables {
    platform = "dummy_temp"
  }
  assert {
    condition     = output.endpoint == "dummy-temp-pg16.staging.invalid:5432"
    error_message = "platform = dummy_temp must give the endpoint of dummy_temp"
  }
}

run "none" {
  command = plan
  variables {
    platform = ""
  }
  assert {
    condition     = output.endpoint == null
    error_message = "no platform must give no endpoint"
  }
}

run "unknown" {
  command = plan
  variables {
    platform = "nope"
  }
  expect_failures = [var.platform]
}
