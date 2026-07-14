# Changelog

All notable changes to this project will be documented in this file. This project uses [Semantic Versioning](https://semver.org/).

## v0.5.0 (Pending Release)

### Changed

- chore: dependency updates
- chore(github): align workflows, funding and issue templates with the other org plugins
- chore: align npm publishing files with the other org plugins
- style: fix lint issues surfaced by the full lint scope
- chore: standardise the package scripts and publishing config
- chore: update the plugin metadata for the new maintainer
- docs: refresh the readme
- feat: add support for more appliance types and improve existing ones (@donavanbecker)
- feat: add a work-in-progress matter implementation (@donavanbecker)
- fix: log the credentials re-authentication at debug level (@donavanbecker)
- fix: apply per-device config overrides to devices (#83) (@colbyr)
- style: fix lint issues in the beta changes
- fix: use url resolution when following authentication redirects (#100) (@smitty078)
- feat: add air conditioner default mode, separate fan service and dry switch options (#101) (@smitty078)
- fix: stop air conditioner api errors from crashing the bridge (#97) (@nicholasodonnell)
- fix: apply every per-device config override to the matching device (#94) (@dzins)
- feat: add support for the in-fridge keurig k-cup brewer (#95) (@dzins)
- fix: track cached matter accessories via the configure callback
- fix: handle websocket errors and reconnect when the connection drops
- chore: remove the empty refresh intervals from the washer, dryer and dishwasher
- chore: remove the unused external accessory option from the config schema

## [0.4.16](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.15...v0.4.16) (2026-04-09)

## [0.4.15](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.14...v0.4.15) (2026-03-01)


### Features

* Add Heat Mode support for SmartHQ Air Conditioner ([#85](https://github.com/homebridge-plugins/homebridge-smarthq/issues/85)) ([6c3a38b](https://github.com/homebridge-plugins/homebridge-smarthq/commit/6c3a38bdccd45cb0f5b0a3375440a0deb13ab1d5))
* Add Swing Mode support for Air Conditioner ([#84](https://github.com/homebridge-plugins/homebridge-smarthq/issues/84)) ([152cf01](https://github.com/homebridge-plugins/homebridge-smarthq/commit/152cf014f339cc5315b325bbde5d82c9c2273d79))

## [0.4.14](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.13...v0.4.14) (2026-01-18)

## [0.4.13](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.12...v0.4.13) (2026-01-14)

## [0.4.12](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.11...v0.4.12) (2026-01-14)


### Bug Fixes

* handle undefined values for fan speed and light level in SmartHQ… ([#74](https://github.com/homebridge-plugins/homebridge-smarthq/issues/74)) ([777a8a0](https://github.com/homebridge-plugins/homebridge-smarthq/commit/777a8a0cb3096068c8193b49c5b90447bcc82929))

## [0.4.11](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.10...v0.4.11) (2025-12-22)

## [0.4.10](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.9...v0.4.10) (2025-12-22)

## [0.4.9](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.8...v0.4.9) (2025-12-22)

## [0.4.8](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.7...v0.4.8) (2025-12-22)

## [0.4.7](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.6...v0.4.7) (2025-12-22)

## [0.4.6](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.4...v0.4.6) (2025-12-22)

## [0.4.4](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.3...v0.4.4) (2025-12-22)


### Reverts

* Revert "update dependenices" ([b3fe90e](https://github.com/homebridge-plugins/homebridge-smarthq/commit/b3fe90ea172fb78b8acd360695cbc3c6b97f0326))

## [0.4.3](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.1...v0.4.3) (2025-12-22)


### Features

* support hood ([#57](https://github.com/homebridge-plugins/homebridge-smarthq/issues/57)) ([2659b21](https://github.com/homebridge-plugins/homebridge-smarthq/commit/2659b21a0a483cb15e0622733f58d75603d99cab))

## [0.4.1](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.0...v0.4.1) (2025-09-18)


### Bug Fixes

* **air conditioner:** fix temperature setting and update switch display names ([#38](https://github.com/homebridge-plugins/homebridge-smarthq/issues/38)) ([1675205](https://github.com/homebridge-plugins/homebridge-smarthq/commit/16752059c93d6a5b26b782f2b42246e622b4b830))
* **air conditioner:** preserve decimal precision when converting Celsius to Fahrenheit ([#40](https://github.com/homebridge-plugins/homebridge-smarthq/issues/40)) ([38c8285](https://github.com/homebridge-plugins/homebridge-smarthq/commit/38c82852015d8ea0ceb0f4dd4b9ddf0622f57963))
* **air conditioner:** report all operating modes off when unit is off ([#42](https://github.com/homebridge-plugins/homebridge-smarthq/issues/42)) ([d44ebe3](https://github.com/homebridge-plugins/homebridge-smarthq/commit/d44ebe34590a2da6645e30db0db269e1dbbe4f3b))


### Features

* add Portable AC as supported device ([#45](https://github.com/homebridge-plugins/homebridge-smarthq/issues/45)) ([50d83b1](https://github.com/homebridge-plugins/homebridge-smarthq/commit/50d83b1e003d8d238485459a5c882f357e1c61fb))

# [0.4.0](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.2.0...v0.4.0) (2025-06-27)

# 0.2.0 (2025-02-23)

## [0.4.15](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.14...v0.4.15) (2026-03-01)


### Features

* Add Heat Mode support for SmartHQ Air Conditioner ([#85](https://github.com/homebridge-plugins/homebridge-smarthq/issues/85)) ([6c3a38b](https://github.com/homebridge-plugins/homebridge-smarthq/commit/6c3a38bdccd45cb0f5b0a3375440a0deb13ab1d5))
* Add Swing Mode support for Air Conditioner ([#84](https://github.com/homebridge-plugins/homebridge-smarthq/issues/84)) ([152cf01](https://github.com/homebridge-plugins/homebridge-smarthq/commit/152cf014f339cc5315b325bbde5d82c9c2273d79))



## [0.4.14](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.13...v0.4.14) (2026-01-18)



## [0.4.13](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.12...v0.4.13) (2026-01-14)



## [0.4.12](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.11...v0.4.12) (2026-01-14)


### Bug Fixes

* handle undefined values for fan speed and light level in SmartHQ… ([#74](https://github.com/homebridge-plugins/homebridge-smarthq/issues/74)) ([777a8a0](https://github.com/homebridge-plugins/homebridge-smarthq/commit/777a8a0cb3096068c8193b49c5b90447bcc82929))



## [0.4.11](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.10...v0.4.11) (2025-12-22)



## [0.4.10](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.9...v0.4.10) (2025-12-22)



## [0.4.9](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.8...v0.4.9) (2025-12-22)



## [0.4.8](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.7...v0.4.8) (2025-12-22)



## [0.4.7](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.6...v0.4.7) (2025-12-22)



## [0.4.6](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.4...v0.4.6) (2025-12-22)



## [0.4.4](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.3...v0.4.4) (2025-12-22)


### Reverts

* Revert "update dependenices" ([b3fe90e](https://github.com/homebridge-plugins/homebridge-smarthq/commit/b3fe90ea172fb78b8acd360695cbc3c6b97f0326))



## [0.4.3](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.1...v0.4.3) (2025-12-22)


### Features

* support hood ([#57](https://github.com/homebridge-plugins/homebridge-smarthq/issues/57)) ([2659b21](https://github.com/homebridge-plugins/homebridge-smarthq/commit/2659b21a0a483cb15e0622733f58d75603d99cab))



## [0.4.1](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.0...v0.4.1) (2025-09-18)


### Bug Fixes

* **air conditioner:** fix temperature setting and update switch display names ([#38](https://github.com/homebridge-plugins/homebridge-smarthq/issues/38)) ([1675205](https://github.com/homebridge-plugins/homebridge-smarthq/commit/16752059c93d6a5b26b782f2b42246e622b4b830))
* **air conditioner:** preserve decimal precision when converting Celsius to Fahrenheit ([#40](https://github.com/homebridge-plugins/homebridge-smarthq/issues/40)) ([38c8285](https://github.com/homebridge-plugins/homebridge-smarthq/commit/38c82852015d8ea0ceb0f4dd4b9ddf0622f57963))
* **air conditioner:** report all operating modes off when unit is off ([#42](https://github.com/homebridge-plugins/homebridge-smarthq/issues/42)) ([d44ebe3](https://github.com/homebridge-plugins/homebridge-smarthq/commit/d44ebe34590a2da6645e30db0db269e1dbbe4f3b))


### Features

* add Portable AC as supported device ([#45](https://github.com/homebridge-plugins/homebridge-smarthq/issues/45)) ([50d83b1](https://github.com/homebridge-plugins/homebridge-smarthq/commit/50d83b1e003d8d238485459a5c882f357e1c61fb))



# [0.4.0](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.2.0...v0.4.0) (2025-06-27)



# 0.2.0 (2025-02-23)

## [0.4.14](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.13...v0.4.14) (2026-01-18)



## [0.4.13](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.12...v0.4.13) (2026-01-14)



## [0.4.12](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.11...v0.4.12) (2026-01-14)


### Bug Fixes

* handle undefined values for fan speed and light level in SmartHQ… ([#74](https://github.com/homebridge-plugins/homebridge-smarthq/issues/74)) ([777a8a0](https://github.com/homebridge-plugins/homebridge-smarthq/commit/777a8a0cb3096068c8193b49c5b90447bcc82929))



## [0.4.11](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.10...v0.4.11) (2025-12-22)



## [0.4.10](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.9...v0.4.10) (2025-12-22)



## [0.4.9](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.8...v0.4.9) (2025-12-22)



## [0.4.8](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.7...v0.4.8) (2025-12-22)



## [0.4.7](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.6...v0.4.7) (2025-12-22)



## [0.4.6](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.4...v0.4.6) (2025-12-22)



## [0.4.4](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.3...v0.4.4) (2025-12-22)


### Reverts

* Revert "update dependenices" ([b3fe90e](https://github.com/homebridge-plugins/homebridge-smarthq/commit/b3fe90ea172fb78b8acd360695cbc3c6b97f0326))



## [0.4.3](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.1...v0.4.3) (2025-12-22)


### Features

* support hood ([#57](https://github.com/homebridge-plugins/homebridge-smarthq/issues/57)) ([2659b21](https://github.com/homebridge-plugins/homebridge-smarthq/commit/2659b21a0a483cb15e0622733f58d75603d99cab))



## [0.4.1](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.0...v0.4.1) (2025-09-18)


### Bug Fixes

* **air conditioner:** fix temperature setting and update switch display names ([#38](https://github.com/homebridge-plugins/homebridge-smarthq/issues/38)) ([1675205](https://github.com/homebridge-plugins/homebridge-smarthq/commit/16752059c93d6a5b26b782f2b42246e622b4b830))
* **air conditioner:** preserve decimal precision when converting Celsius to Fahrenheit ([#40](https://github.com/homebridge-plugins/homebridge-smarthq/issues/40)) ([38c8285](https://github.com/homebridge-plugins/homebridge-smarthq/commit/38c82852015d8ea0ceb0f4dd4b9ddf0622f57963))
* **air conditioner:** report all operating modes off when unit is off ([#42](https://github.com/homebridge-plugins/homebridge-smarthq/issues/42)) ([d44ebe3](https://github.com/homebridge-plugins/homebridge-smarthq/commit/d44ebe34590a2da6645e30db0db269e1dbbe4f3b))


### Features

* add Portable AC as supported device ([#45](https://github.com/homebridge-plugins/homebridge-smarthq/issues/45)) ([50d83b1](https://github.com/homebridge-plugins/homebridge-smarthq/commit/50d83b1e003d8d238485459a5c882f357e1c61fb))



# [0.4.0](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.2.0...v0.4.0) (2025-06-27)



# 0.2.0 (2025-02-23)

## [0.4.13](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.12...v0.4.13) (2026-01-14)



## [0.4.12](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.11...v0.4.12) (2026-01-14)


### Bug Fixes

* handle undefined values for fan speed and light level in SmartHQ… ([#74](https://github.com/homebridge-plugins/homebridge-smarthq/issues/74)) ([777a8a0](https://github.com/homebridge-plugins/homebridge-smarthq/commit/777a8a0cb3096068c8193b49c5b90447bcc82929))



## [0.4.11](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.10...v0.4.11) (2025-12-22)



## [0.4.10](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.9...v0.4.10) (2025-12-22)



## [0.4.9](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.8...v0.4.9) (2025-12-22)



## [0.4.8](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.7...v0.4.8) (2025-12-22)



## [0.4.7](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.6...v0.4.7) (2025-12-22)



## [0.4.6](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.4...v0.4.6) (2025-12-22)



## [0.4.4](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.3...v0.4.4) (2025-12-22)


### Reverts

* Revert "update dependenices" ([b3fe90e](https://github.com/homebridge-plugins/homebridge-smarthq/commit/b3fe90ea172fb78b8acd360695cbc3c6b97f0326))



## [0.4.3](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.1...v0.4.3) (2025-12-22)


### Features

* support hood ([#57](https://github.com/homebridge-plugins/homebridge-smarthq/issues/57)) ([2659b21](https://github.com/homebridge-plugins/homebridge-smarthq/commit/2659b21a0a483cb15e0622733f58d75603d99cab))



## [0.4.1](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.0...v0.4.1) (2025-09-18)


### Bug Fixes

* **air conditioner:** fix temperature setting and update switch display names ([#38](https://github.com/homebridge-plugins/homebridge-smarthq/issues/38)) ([1675205](https://github.com/homebridge-plugins/homebridge-smarthq/commit/16752059c93d6a5b26b782f2b42246e622b4b830))
* **air conditioner:** preserve decimal precision when converting Celsius to Fahrenheit ([#40](https://github.com/homebridge-plugins/homebridge-smarthq/issues/40)) ([38c8285](https://github.com/homebridge-plugins/homebridge-smarthq/commit/38c82852015d8ea0ceb0f4dd4b9ddf0622f57963))
* **air conditioner:** report all operating modes off when unit is off ([#42](https://github.com/homebridge-plugins/homebridge-smarthq/issues/42)) ([d44ebe3](https://github.com/homebridge-plugins/homebridge-smarthq/commit/d44ebe34590a2da6645e30db0db269e1dbbe4f3b))


### Features

* add Portable AC as supported device ([#45](https://github.com/homebridge-plugins/homebridge-smarthq/issues/45)) ([50d83b1](https://github.com/homebridge-plugins/homebridge-smarthq/commit/50d83b1e003d8d238485459a5c882f357e1c61fb))



# [0.4.0](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.2.0...v0.4.0) (2025-06-27)



# 0.2.0 (2025-02-23)

## [0.4.12](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.11...v0.4.12) (2026-01-14)


### Bug Fixes

* handle undefined values for fan speed and light level in SmartHQ… ([#74](https://github.com/homebridge-plugins/homebridge-smarthq/issues/74)) ([777a8a0](https://github.com/homebridge-plugins/homebridge-smarthq/commit/777a8a0cb3096068c8193b49c5b90447bcc82929))



## [0.4.11](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.10...v0.4.11) (2025-12-22)



## [0.4.10](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.9...v0.4.10) (2025-12-22)



## [0.4.9](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.8...v0.4.9) (2025-12-22)



## [0.4.8](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.7...v0.4.8) (2025-12-22)



## [0.4.7](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.6...v0.4.7) (2025-12-22)



## [0.4.6](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.4...v0.4.6) (2025-12-22)



## [0.4.4](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.3...v0.4.4) (2025-12-22)


### Reverts

* Revert "update dependenices" ([b3fe90e](https://github.com/homebridge-plugins/homebridge-smarthq/commit/b3fe90ea172fb78b8acd360695cbc3c6b97f0326))



## [0.4.3](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.1...v0.4.3) (2025-12-22)


### Features

* support hood ([#57](https://github.com/homebridge-plugins/homebridge-smarthq/issues/57)) ([2659b21](https://github.com/homebridge-plugins/homebridge-smarthq/commit/2659b21a0a483cb15e0622733f58d75603d99cab))



## [0.4.1](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.0...v0.4.1) (2025-09-18)


### Bug Fixes

* **air conditioner:** fix temperature setting and update switch display names ([#38](https://github.com/homebridge-plugins/homebridge-smarthq/issues/38)) ([1675205](https://github.com/homebridge-plugins/homebridge-smarthq/commit/16752059c93d6a5b26b782f2b42246e622b4b830))
* **air conditioner:** preserve decimal precision when converting Celsius to Fahrenheit ([#40](https://github.com/homebridge-plugins/homebridge-smarthq/issues/40)) ([38c8285](https://github.com/homebridge-plugins/homebridge-smarthq/commit/38c82852015d8ea0ceb0f4dd4b9ddf0622f57963))
* **air conditioner:** report all operating modes off when unit is off ([#42](https://github.com/homebridge-plugins/homebridge-smarthq/issues/42)) ([d44ebe3](https://github.com/homebridge-plugins/homebridge-smarthq/commit/d44ebe34590a2da6645e30db0db269e1dbbe4f3b))


### Features

* add Portable AC as supported device ([#45](https://github.com/homebridge-plugins/homebridge-smarthq/issues/45)) ([50d83b1](https://github.com/homebridge-plugins/homebridge-smarthq/commit/50d83b1e003d8d238485459a5c882f357e1c61fb))



# [0.4.0](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.2.0...v0.4.0) (2025-06-27)



# 0.2.0 (2025-02-23)

## [0.4.11](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.10...v0.4.11) (2025-12-22)



## [0.4.10](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.9...v0.4.10) (2025-12-22)



## [0.4.9](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.8...v0.4.9) (2025-12-22)



## [0.4.8](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.7...v0.4.8) (2025-12-22)



## [0.4.7](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.6...v0.4.7) (2025-12-22)



## [0.4.6](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.4...v0.4.6) (2025-12-22)



## [0.4.4](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.3...v0.4.4) (2025-12-22)


### Reverts

* Revert "update dependenices" ([b3fe90e](https://github.com/homebridge-plugins/homebridge-smarthq/commit/b3fe90ea172fb78b8acd360695cbc3c6b97f0326))



## [0.4.3](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.1...v0.4.3) (2025-12-22)


### Features

* support hood ([#57](https://github.com/homebridge-plugins/homebridge-smarthq/issues/57)) ([2659b21](https://github.com/homebridge-plugins/homebridge-smarthq/commit/2659b21a0a483cb15e0622733f58d75603d99cab))



## [0.4.1](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.0...v0.4.1) (2025-09-18)


### Bug Fixes

* **air conditioner:** fix temperature setting and update switch display names ([#38](https://github.com/homebridge-plugins/homebridge-smarthq/issues/38)) ([1675205](https://github.com/homebridge-plugins/homebridge-smarthq/commit/16752059c93d6a5b26b782f2b42246e622b4b830))
* **air conditioner:** preserve decimal precision when converting Celsius to Fahrenheit ([#40](https://github.com/homebridge-plugins/homebridge-smarthq/issues/40)) ([38c8285](https://github.com/homebridge-plugins/homebridge-smarthq/commit/38c82852015d8ea0ceb0f4dd4b9ddf0622f57963))
* **air conditioner:** report all operating modes off when unit is off ([#42](https://github.com/homebridge-plugins/homebridge-smarthq/issues/42)) ([d44ebe3](https://github.com/homebridge-plugins/homebridge-smarthq/commit/d44ebe34590a2da6645e30db0db269e1dbbe4f3b))


### Features

* add Portable AC as supported device ([#45](https://github.com/homebridge-plugins/homebridge-smarthq/issues/45)) ([50d83b1](https://github.com/homebridge-plugins/homebridge-smarthq/commit/50d83b1e003d8d238485459a5c882f357e1c61fb))



# [0.4.0](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.2.0...v0.4.0) (2025-06-27)



# 0.2.0 (2025-02-23)

## [0.4.10](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.9...v0.4.10) (2025-12-22)



## [0.4.9](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.8...v0.4.9) (2025-12-22)



## [0.4.8](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.7...v0.4.8) (2025-12-22)



## [0.4.7](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.6...v0.4.7) (2025-12-22)



## [0.4.6](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.4...v0.4.6) (2025-12-22)



## [0.4.4](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.3...v0.4.4) (2025-12-22)


### Reverts

* Revert "update dependenices" ([b3fe90e](https://github.com/homebridge-plugins/homebridge-smarthq/commit/b3fe90ea172fb78b8acd360695cbc3c6b97f0326))



## [0.4.3](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.1...v0.4.3) (2025-12-22)


### Features

* support hood ([#57](https://github.com/homebridge-plugins/homebridge-smarthq/issues/57)) ([2659b21](https://github.com/homebridge-plugins/homebridge-smarthq/commit/2659b21a0a483cb15e0622733f58d75603d99cab))



## [0.4.1](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.0...v0.4.1) (2025-09-18)


### Bug Fixes

* **air conditioner:** fix temperature setting and update switch display names ([#38](https://github.com/homebridge-plugins/homebridge-smarthq/issues/38)) ([1675205](https://github.com/homebridge-plugins/homebridge-smarthq/commit/16752059c93d6a5b26b782f2b42246e622b4b830))
* **air conditioner:** preserve decimal precision when converting Celsius to Fahrenheit ([#40](https://github.com/homebridge-plugins/homebridge-smarthq/issues/40)) ([38c8285](https://github.com/homebridge-plugins/homebridge-smarthq/commit/38c82852015d8ea0ceb0f4dd4b9ddf0622f57963))
* **air conditioner:** report all operating modes off when unit is off ([#42](https://github.com/homebridge-plugins/homebridge-smarthq/issues/42)) ([d44ebe3](https://github.com/homebridge-plugins/homebridge-smarthq/commit/d44ebe34590a2da6645e30db0db269e1dbbe4f3b))


### Features

* add Portable AC as supported device ([#45](https://github.com/homebridge-plugins/homebridge-smarthq/issues/45)) ([50d83b1](https://github.com/homebridge-plugins/homebridge-smarthq/commit/50d83b1e003d8d238485459a5c882f357e1c61fb))



# [0.4.0](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.2.0...v0.4.0) (2025-06-27)



# 0.2.0 (2025-02-23)

## [0.4.9](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.8...v0.4.9) (2025-12-22)



## [0.4.8](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.7...v0.4.8) (2025-12-22)



## [0.4.7](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.6...v0.4.7) (2025-12-22)



## [0.4.6](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.4...v0.4.6) (2025-12-22)



## [0.4.4](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.3...v0.4.4) (2025-12-22)


### Reverts

* Revert "update dependenices" ([b3fe90e](https://github.com/homebridge-plugins/homebridge-smarthq/commit/b3fe90ea172fb78b8acd360695cbc3c6b97f0326))



## [0.4.3](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.1...v0.4.3) (2025-12-22)


### Features

* support hood ([#57](https://github.com/homebridge-plugins/homebridge-smarthq/issues/57)) ([2659b21](https://github.com/homebridge-plugins/homebridge-smarthq/commit/2659b21a0a483cb15e0622733f58d75603d99cab))



## [0.4.1](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.0...v0.4.1) (2025-09-18)


### Bug Fixes

* **air conditioner:** fix temperature setting and update switch display names ([#38](https://github.com/homebridge-plugins/homebridge-smarthq/issues/38)) ([1675205](https://github.com/homebridge-plugins/homebridge-smarthq/commit/16752059c93d6a5b26b782f2b42246e622b4b830))
* **air conditioner:** preserve decimal precision when converting Celsius to Fahrenheit ([#40](https://github.com/homebridge-plugins/homebridge-smarthq/issues/40)) ([38c8285](https://github.com/homebridge-plugins/homebridge-smarthq/commit/38c82852015d8ea0ceb0f4dd4b9ddf0622f57963))
* **air conditioner:** report all operating modes off when unit is off ([#42](https://github.com/homebridge-plugins/homebridge-smarthq/issues/42)) ([d44ebe3](https://github.com/homebridge-plugins/homebridge-smarthq/commit/d44ebe34590a2da6645e30db0db269e1dbbe4f3b))


### Features

* add Portable AC as supported device ([#45](https://github.com/homebridge-plugins/homebridge-smarthq/issues/45)) ([50d83b1](https://github.com/homebridge-plugins/homebridge-smarthq/commit/50d83b1e003d8d238485459a5c882f357e1c61fb))



# [0.4.0](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.2.0...v0.4.0) (2025-06-27)



# 0.2.0 (2025-02-23)

## [0.4.8](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.7...v0.4.8) (2025-12-22)



## [0.4.7](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.6...v0.4.7) (2025-12-22)



## [0.4.6](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.4...v0.4.6) (2025-12-22)



## [0.4.4](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.3...v0.4.4) (2025-12-22)


### Reverts

* Revert "update dependenices" ([b3fe90e](https://github.com/homebridge-plugins/homebridge-smarthq/commit/b3fe90ea172fb78b8acd360695cbc3c6b97f0326))



## [0.4.3](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.1...v0.4.3) (2025-12-22)


### Features

* support hood ([#57](https://github.com/homebridge-plugins/homebridge-smarthq/issues/57)) ([2659b21](https://github.com/homebridge-plugins/homebridge-smarthq/commit/2659b21a0a483cb15e0622733f58d75603d99cab))



## [0.4.1](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.0...v0.4.1) (2025-09-18)


### Bug Fixes

* **air conditioner:** fix temperature setting and update switch display names ([#38](https://github.com/homebridge-plugins/homebridge-smarthq/issues/38)) ([1675205](https://github.com/homebridge-plugins/homebridge-smarthq/commit/16752059c93d6a5b26b782f2b42246e622b4b830))
* **air conditioner:** preserve decimal precision when converting Celsius to Fahrenheit ([#40](https://github.com/homebridge-plugins/homebridge-smarthq/issues/40)) ([38c8285](https://github.com/homebridge-plugins/homebridge-smarthq/commit/38c82852015d8ea0ceb0f4dd4b9ddf0622f57963))
* **air conditioner:** report all operating modes off when unit is off ([#42](https://github.com/homebridge-plugins/homebridge-smarthq/issues/42)) ([d44ebe3](https://github.com/homebridge-plugins/homebridge-smarthq/commit/d44ebe34590a2da6645e30db0db269e1dbbe4f3b))


### Features

* add Portable AC as supported device ([#45](https://github.com/homebridge-plugins/homebridge-smarthq/issues/45)) ([50d83b1](https://github.com/homebridge-plugins/homebridge-smarthq/commit/50d83b1e003d8d238485459a5c882f357e1c61fb))



# [0.4.0](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.2.0...v0.4.0) (2025-06-27)



# 0.2.0 (2025-02-23)

## [0.4.7](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.6...v0.4.7) (2025-12-22)



## [0.4.6](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.4...v0.4.6) (2025-12-22)



## [0.4.4](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.3...v0.4.4) (2025-12-22)


### Reverts

* Revert "update dependenices" ([b3fe90e](https://github.com/homebridge-plugins/homebridge-smarthq/commit/b3fe90ea172fb78b8acd360695cbc3c6b97f0326))



## [0.4.3](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.1...v0.4.3) (2025-12-22)


### Features

* support hood ([#57](https://github.com/homebridge-plugins/homebridge-smarthq/issues/57)) ([2659b21](https://github.com/homebridge-plugins/homebridge-smarthq/commit/2659b21a0a483cb15e0622733f58d75603d99cab))



## [0.4.1](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.0...v0.4.1) (2025-09-18)


### Bug Fixes

* **air conditioner:** fix temperature setting and update switch display names ([#38](https://github.com/homebridge-plugins/homebridge-smarthq/issues/38)) ([1675205](https://github.com/homebridge-plugins/homebridge-smarthq/commit/16752059c93d6a5b26b782f2b42246e622b4b830))
* **air conditioner:** preserve decimal precision when converting Celsius to Fahrenheit ([#40](https://github.com/homebridge-plugins/homebridge-smarthq/issues/40)) ([38c8285](https://github.com/homebridge-plugins/homebridge-smarthq/commit/38c82852015d8ea0ceb0f4dd4b9ddf0622f57963))
* **air conditioner:** report all operating modes off when unit is off ([#42](https://github.com/homebridge-plugins/homebridge-smarthq/issues/42)) ([d44ebe3](https://github.com/homebridge-plugins/homebridge-smarthq/commit/d44ebe34590a2da6645e30db0db269e1dbbe4f3b))


### Features

* add Portable AC as supported device ([#45](https://github.com/homebridge-plugins/homebridge-smarthq/issues/45)) ([50d83b1](https://github.com/homebridge-plugins/homebridge-smarthq/commit/50d83b1e003d8d238485459a5c882f357e1c61fb))



# [0.4.0](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.2.0...v0.4.0) (2025-06-27)



# 0.2.0 (2025-02-23)

## [0.4.6](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.4...v0.4.6) (2025-12-22)



## [0.4.4](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.3...v0.4.4) (2025-12-22)


### Reverts

* Revert "update dependenices" ([b3fe90e](https://github.com/homebridge-plugins/homebridge-smarthq/commit/b3fe90ea172fb78b8acd360695cbc3c6b97f0326))



## [0.4.3](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.1...v0.4.3) (2025-12-22)


### Features

* support hood ([#57](https://github.com/homebridge-plugins/homebridge-smarthq/issues/57)) ([2659b21](https://github.com/homebridge-plugins/homebridge-smarthq/commit/2659b21a0a483cb15e0622733f58d75603d99cab))



## [0.4.1](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.0...v0.4.1) (2025-09-18)


### Bug Fixes

* **air conditioner:** fix temperature setting and update switch display names ([#38](https://github.com/homebridge-plugins/homebridge-smarthq/issues/38)) ([1675205](https://github.com/homebridge-plugins/homebridge-smarthq/commit/16752059c93d6a5b26b782f2b42246e622b4b830))
* **air conditioner:** preserve decimal precision when converting Celsius to Fahrenheit ([#40](https://github.com/homebridge-plugins/homebridge-smarthq/issues/40)) ([38c8285](https://github.com/homebridge-plugins/homebridge-smarthq/commit/38c82852015d8ea0ceb0f4dd4b9ddf0622f57963))
* **air conditioner:** report all operating modes off when unit is off ([#42](https://github.com/homebridge-plugins/homebridge-smarthq/issues/42)) ([d44ebe3](https://github.com/homebridge-plugins/homebridge-smarthq/commit/d44ebe34590a2da6645e30db0db269e1dbbe4f3b))


### Features

* add Portable AC as supported device ([#45](https://github.com/homebridge-plugins/homebridge-smarthq/issues/45)) ([50d83b1](https://github.com/homebridge-plugins/homebridge-smarthq/commit/50d83b1e003d8d238485459a5c882f357e1c61fb))



# [0.4.0](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.2.0...v0.4.0) (2025-06-27)



# 0.2.0 (2025-02-23)

## [0.4.6](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.4...v0.4.6) (2025-12-22)



## [0.4.4](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.3...v0.4.4) (2025-12-22)


### Reverts

* Revert "update dependenices" ([b3fe90e](https://github.com/homebridge-plugins/homebridge-smarthq/commit/b3fe90ea172fb78b8acd360695cbc3c6b97f0326))



## [0.4.3](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.1...v0.4.3) (2025-12-22)


### Features

* support hood ([#57](https://github.com/homebridge-plugins/homebridge-smarthq/issues/57)) ([2659b21](https://github.com/homebridge-plugins/homebridge-smarthq/commit/2659b21a0a483cb15e0622733f58d75603d99cab))



## [0.4.1](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.0...v0.4.1) (2025-09-18)


### Bug Fixes

* **air conditioner:** fix temperature setting and update switch display names ([#38](https://github.com/homebridge-plugins/homebridge-smarthq/issues/38)) ([1675205](https://github.com/homebridge-plugins/homebridge-smarthq/commit/16752059c93d6a5b26b782f2b42246e622b4b830))
* **air conditioner:** preserve decimal precision when converting Celsius to Fahrenheit ([#40](https://github.com/homebridge-plugins/homebridge-smarthq/issues/40)) ([38c8285](https://github.com/homebridge-plugins/homebridge-smarthq/commit/38c82852015d8ea0ceb0f4dd4b9ddf0622f57963))
* **air conditioner:** report all operating modes off when unit is off ([#42](https://github.com/homebridge-plugins/homebridge-smarthq/issues/42)) ([d44ebe3](https://github.com/homebridge-plugins/homebridge-smarthq/commit/d44ebe34590a2da6645e30db0db269e1dbbe4f3b))


### Features

* add Portable AC as supported device ([#45](https://github.com/homebridge-plugins/homebridge-smarthq/issues/45)) ([50d83b1](https://github.com/homebridge-plugins/homebridge-smarthq/commit/50d83b1e003d8d238485459a5c882f357e1c61fb))



# [0.4.0](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.2.0...v0.4.0) (2025-06-27)



# 0.2.0 (2025-02-23)

## [0.4.6](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.4...v0.4.6) (2025-12-22)



## [0.4.4](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.3...v0.4.4) (2025-12-22)


### Reverts

* Revert "update dependenices" ([b3fe90e](https://github.com/homebridge-plugins/homebridge-smarthq/commit/b3fe90ea172fb78b8acd360695cbc3c6b97f0326))



## [0.4.3](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.1...v0.4.3) (2025-12-22)


### Features

* support hood ([#57](https://github.com/homebridge-plugins/homebridge-smarthq/issues/57)) ([2659b21](https://github.com/homebridge-plugins/homebridge-smarthq/commit/2659b21a0a483cb15e0622733f58d75603d99cab))



## [0.4.1](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.0...v0.4.1) (2025-09-18)


### Bug Fixes

* **air conditioner:** fix temperature setting and update switch display names ([#38](https://github.com/homebridge-plugins/homebridge-smarthq/issues/38)) ([1675205](https://github.com/homebridge-plugins/homebridge-smarthq/commit/16752059c93d6a5b26b782f2b42246e622b4b830))
* **air conditioner:** preserve decimal precision when converting Celsius to Fahrenheit ([#40](https://github.com/homebridge-plugins/homebridge-smarthq/issues/40)) ([38c8285](https://github.com/homebridge-plugins/homebridge-smarthq/commit/38c82852015d8ea0ceb0f4dd4b9ddf0622f57963))
* **air conditioner:** report all operating modes off when unit is off ([#42](https://github.com/homebridge-plugins/homebridge-smarthq/issues/42)) ([d44ebe3](https://github.com/homebridge-plugins/homebridge-smarthq/commit/d44ebe34590a2da6645e30db0db269e1dbbe4f3b))


### Features

* add Portable AC as supported device ([#45](https://github.com/homebridge-plugins/homebridge-smarthq/issues/45)) ([50d83b1](https://github.com/homebridge-plugins/homebridge-smarthq/commit/50d83b1e003d8d238485459a5c882f357e1c61fb))



# [0.4.0](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.2.0...v0.4.0) (2025-06-27)



# 0.2.0 (2025-02-23)

## [0.4.5](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.4...v0.4.5) (2025-12-22)



## [0.4.4](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.3...v0.4.4) (2025-12-22)


### Reverts

* Revert "update dependenices" ([b3fe90e](https://github.com/homebridge-plugins/homebridge-smarthq/commit/b3fe90ea172fb78b8acd360695cbc3c6b97f0326))



## [0.4.3](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.1...v0.4.3) (2025-12-22)


### Features

* support hood ([#57](https://github.com/homebridge-plugins/homebridge-smarthq/issues/57)) ([2659b21](https://github.com/homebridge-plugins/homebridge-smarthq/commit/2659b21a0a483cb15e0622733f58d75603d99cab))



## [0.4.1](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.0...v0.4.1) (2025-09-18)


### Bug Fixes

* **air conditioner:** fix temperature setting and update switch display names ([#38](https://github.com/homebridge-plugins/homebridge-smarthq/issues/38)) ([1675205](https://github.com/homebridge-plugins/homebridge-smarthq/commit/16752059c93d6a5b26b782f2b42246e622b4b830))
* **air conditioner:** preserve decimal precision when converting Celsius to Fahrenheit ([#40](https://github.com/homebridge-plugins/homebridge-smarthq/issues/40)) ([38c8285](https://github.com/homebridge-plugins/homebridge-smarthq/commit/38c82852015d8ea0ceb0f4dd4b9ddf0622f57963))
* **air conditioner:** report all operating modes off when unit is off ([#42](https://github.com/homebridge-plugins/homebridge-smarthq/issues/42)) ([d44ebe3](https://github.com/homebridge-plugins/homebridge-smarthq/commit/d44ebe34590a2da6645e30db0db269e1dbbe4f3b))


### Features

* add Portable AC as supported device ([#45](https://github.com/homebridge-plugins/homebridge-smarthq/issues/45)) ([50d83b1](https://github.com/homebridge-plugins/homebridge-smarthq/commit/50d83b1e003d8d238485459a5c882f357e1c61fb))



# [0.4.0](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.2.0...v0.4.0) (2025-06-27)



# 0.2.0 (2025-02-23)

## [0.4.5](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.4...v0.4.5) (2025-12-22)



## [0.4.4](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.3...v0.4.4) (2025-12-22)


### Reverts

* Revert "update dependenices" ([b3fe90e](https://github.com/homebridge-plugins/homebridge-smarthq/commit/b3fe90ea172fb78b8acd360695cbc3c6b97f0326))



## [0.4.3](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.1...v0.4.3) (2025-12-22)


### Features

* support hood ([#57](https://github.com/homebridge-plugins/homebridge-smarthq/issues/57)) ([2659b21](https://github.com/homebridge-plugins/homebridge-smarthq/commit/2659b21a0a483cb15e0622733f58d75603d99cab))



## [0.4.1](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.0...v0.4.1) (2025-09-18)


### Bug Fixes

* **air conditioner:** fix temperature setting and update switch display names ([#38](https://github.com/homebridge-plugins/homebridge-smarthq/issues/38)) ([1675205](https://github.com/homebridge-plugins/homebridge-smarthq/commit/16752059c93d6a5b26b782f2b42246e622b4b830))
* **air conditioner:** preserve decimal precision when converting Celsius to Fahrenheit ([#40](https://github.com/homebridge-plugins/homebridge-smarthq/issues/40)) ([38c8285](https://github.com/homebridge-plugins/homebridge-smarthq/commit/38c82852015d8ea0ceb0f4dd4b9ddf0622f57963))
* **air conditioner:** report all operating modes off when unit is off ([#42](https://github.com/homebridge-plugins/homebridge-smarthq/issues/42)) ([d44ebe3](https://github.com/homebridge-plugins/homebridge-smarthq/commit/d44ebe34590a2da6645e30db0db269e1dbbe4f3b))


### Features

* add Portable AC as supported device ([#45](https://github.com/homebridge-plugins/homebridge-smarthq/issues/45)) ([50d83b1](https://github.com/homebridge-plugins/homebridge-smarthq/commit/50d83b1e003d8d238485459a5c882f357e1c61fb))



# [0.4.0](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.2.0...v0.4.0) (2025-06-27)



# 0.2.0 (2025-02-23)

---

## [0.4.4](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.3...v0.4.4) (2025-12-22)

### Reverts

- Revert "update dependenices" ([b3fe90e](https://github.com/homebridge-plugins/homebridge-smarthq/commit/b3fe90ea172fb78b8acd360695cbc3c6b97f0326))

---

## [0.4.3](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.1...v0.4.3) (2025-12-22)

### Features

- support hood ([#57](https://github.com/homebridge-plugins/homebridge-smarthq/issues/57)) ([2659b21](https://github.com/homebridge-plugins/homebridge-smarthq/commit/2659b21a0a483cb15e0622733f58d75603d99cab))

---

## [0.4.2](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.1...v0.4.2) (2025-11-21)

### Features

- support hood ([#57](https://github.com/homebridge-plugins/homebridge-smarthq/issues/57)) ([6a98928](https://github.com/homebridge-plugins/homebridge-smarthq/commit/6a989281dcac32d8c47fd78a2eb7bcd76c67c0b5))

---

## [0.4.1](https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.4.0...v0.4.1) (2025-09-18)

### Bug Fixes

- **air conditioner:** fix temperature setting and update switch display names ([#38](https://github.com/homebridge-plugins/homebridge-smarthq/issues/38)) ([1675205](https://github.com/homebridge-plugins/homebridge-smarthq/commit/16752059c93d6a5b26b782f2b42246e622b4b830))
- **air conditioner:** preserve decimal precision when converting Celsius to Fahrenheit ([#40](https://github.com/homebridge-plugins/homebridge-smarthq/issues/40)) ([38c8285](https://github.com/homebridge-plugins/homebridge-smarthq/commit/38c82852015d8ea0ceb0f4dd4b9ddf0622f57963))
- **air conditioner:** report all operating modes off when unit is off ([#42](https://github.com/homebridge-plugins/homebridge-smarthq/issues/42)) ([d44ebe3](https://github.com/homebridge-plugins/homebridge-smarthq/commit/d44ebe34590a2da6645e30db0db269e1dbbe4f3b))

### Features

- add Portable AC as supported device ([#45](https://github.com/homebridge-plugins/homebridge-smarthq/issues/45)) ([50d83b1](https://github.com/homebridge-plugins/homebridge-smarthq/commit/50d83b1e003d8d238485459a5c882f357e1c61fb))

---

## [0.4.0](https://github.com/homebridge-plugins/homebridge-smarthq/releases/tag/v0.4.0) (2025-06-26)

### What's Changed

- Add air conditioner support ([#34](https://github.com/homebridge-plugins/homebridge-smarthq/pull/34)), Thanks [@nicholasodonnell](https://github.com/nicholasodonnell)
- Opal Monitoring Services Improvements ([#26](https://github.com/homebridge-plugins/homebridge-smarthq/pull/26)), Thanks [@jamesh48](https://github.com/jamesh48)
- Opal Scheduling Manager ([#25](https://github.com/homebridge-plugins/homebridge-smarthq/pull/25)), Thanks [@jamesh48](https://github.com/jamesh48)
- Fast Follower - Remove Unnecessary info logs ([#24](https://github.com/homebridge-plugins/homebridge-smarthq/pull/24)), Thanks [@jamesh48](https://github.com/jamesh48)
- Opal Ice Maker - Labels, Sorting, Auto Shutoff Feature, Descale Notification ([#23](https://github.com/homebridge-plugins/homebridge-smarthq/pull/23)), Thanks [@jamesh48](https://github.com/jamesh48)
- Favor deviceOptions over options for options that are specific to devices ([#21](https://github.com/homebridge-plugins/homebridge-smarthq/pull/21)), Thanks [@jamesh48](https://github.com/jamesh48)
- Opal Ice Maker Production/Progress Feature ([#20](https://github.com/homebridge-plugins/homebridge-smarthq/pull/20)), Thanks [@jamesh48](https://github.com/jamesh48)
- Housekeeping and updated dependencies

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.3.0...v0.4.0

---

## [0.3.0](https://github.com/homebridge-plugins/homebridge-smarthq/releases/tag/v0.3.0) (2025-03-04)

### What's Changed

- Opal Ice Maker Production/Progress Feature ([#17](https://github.com/homebridge-plugins/homebridge-smarthq/pull/17)), Thanks [@jamesh48](https://github.com/jamesh48)
- Housekeeping and updated dependencies

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.2.0...v0.3.0

---

## [0.2.0](https://github.com/homebridge-plugins/homebridge-smarthq/releases/tag/v0.2.0) (2025-02-23)

### What's Changed

- Basic Support for Opal Ice Maker 2.0 ([#14](https://github.com/homebridge-plugins/homebridge-smarthq/pull/14)), Thanks [@jamesh48](https://github.com/jamesh48)
- Basic Support for Ovens

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-smarthq/compare/v0.1.0...v0.2.0

---

## [0.1.0](https://github.com/homebridge-plugins/homebridge-smarthq/releases/tag/v0.1.0) (2024-09-07)

### What's Changed

- Initial Release

