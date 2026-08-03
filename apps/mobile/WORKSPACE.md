# Straumvakt Driver App

`apps/mobile` is the only Flutter driver-app workspace in this repository.

It owns driver authentication, charger discovery, BLE proximity, NFC tag
reading, session flows, and the driver UI. NFC support is transport-only until
an explicit driver interaction resolves a tag against authorized chargers.

The previous `apps/driver` prototype was consolidated here. Do not create a
second Flutter driver app; add future driver work to this workspace.
