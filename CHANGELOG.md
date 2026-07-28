# Changelog

All notable changes to this project will be documented in this file. This project uses [Semantic Versioning](https://semver.org/).

## v0.6.1 (Pending Release)

### Changed

- chore: keep test files out of the published package
- chore: declare support for node 26
- chore(github): run the build and tests in ci, on node 22, 24 and 26
- chore: use the same lint setup across every plugin

## v0.6.0 (2026-07-26)

### Changed

- chore(github): allow the codeql scan to be started manually
- chore(github): stop concurrent release runs racing for the same version
- chore: add the supports-matter keyword
- feat: add Combination Washer Dryer support (#96)
- chore(github): use the shared homebridge action to deprecate past pre-releases
- feat: control the oven from homekit - start a bake, set the temperature and turn it off (#8)
- fix: read the dishwasher's real state codes instead of fabricated ones, with live updates and time remaining (#22)
- docs: changelog for the oven control and dishwasher rework
- docs: standardise the readme sections and point setup links at the wiki
- fix(schema): restore the settings screen banner, which pointed at a deleted svg
- docs: changelog for the combination washer/dryer support (#96)
- feat: add the lower oven on double ovens - light, temperature, probe and cook time (#46)
- fix(ui): fix the custom UI banner image, which still pointed at the deleted svg
- fix: give every homekit tile its proper name instead of generic labels like Switch 1
- feat: support accounts with 2fa and reuse the saved login token across restarts
- feat(ui): add, remove and hide devices from the config via the devices tab
- style(ui): standardise the custom ui layout and sync the support tab with the readme
- feat(ui): add a remove all devices action to the my devices tab
- fix(schema): declare required fields the standard way so the homebridge ui stops reporting a config validation failure
- chore: declare the supports-hap transport keyword for the homebridge ui
- docs(changelog): list every unreleased commit in the pending section
- chore(deps): dependency updates

## v0.5.2 (2026-07-20)

### Changed

- fix(schema): give the logging levels clear, distinct names
- chore(deps): dependency updates

## v0.5.1 (2026-07-19)

### Changed

- fix: show the oven's real temperature, probe presence and cooking state instead of misleading values (#8) (@dfinstein)
- feat: update the oven's homekit tiles live as the appliance pushes changes (#8) (@dfinstein)
- feat: show a cooktop on/off tile when the range reports its cooktop status (#8) (@dfinstein)

## v0.5.0 (2026-07-18)

⚠️ This plugin now requires Homebridge v2 (needed for the Matter support) and Node v22 or v24.

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
- feat: read real filter life, water flow and leak data for home water filters (#10) (@fratinize)
- fix: correct the laundry door contact direction and running state detection (#60) (@Wazza151)
- fix: poll the correct erd codes for the laundry cycle, door and door lock (#60) (@Wazza151)
- feat: add an optional running switch for washers and dryers (#60) (@Wazza151)
- fix: treat the laundry time remaining value as seconds and clamp it for homekit (#60) (@Wazza151)
- fix: recognise home water filters that report their type without the whole prefix (#10) (@cainmp)
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
- chore: standardise the eslint setup with the other org plugins
- refactor: store device instances on their accessories like the other org plugins
- style: apply the standardised lint rules
- chore: require homebridge v2 and node v22 or v24
- fix: raise the login request timeout from 3.5 to 15 seconds (#7) (#73)
- feat: add an account region option for the login flow (#30)
- chore: align the dev tooling with the other org plugins
- feat: add an option to hide heat mode on cooling-only air conditioners (#73)
- fix: stop polling swing mode on air conditioners that do not support it (#99)
- chore(github): update the setup-node action to v7
- fix: recognise water heaters that report their type without the whole home prefix (#62) (@socalcal) (@krauzac)
- feat: read appliance values from the live websocket feed instead of fetching them (#10) (@fratinize)
- fix: match erd codes regardless of the case they are written in (#10) (@fratinize)
- fix: update the water filter tiles the moment the appliance reports a change (#10) (@cainmp) (@fratinize)
- fix: show the water flow tile as a plain off/running instead of "stopping" on some filters (#10) (@fratinize)
- feat: add an option to expose the water filter life as a battery (#10) (@fratinize)
- feat: add an option to hide the air conditioner mode switches for a minimal tile (#76) (@jwcoop3r-87)
- fix: remove the oven door lock tile and stop the cook time tile pretending to be a control (#8) (@dfinstein)
- fix: hide the oven light and remote enabled tiles on ovens that do not report them (#8) (@dfinstein)
- chore: log the oven light availability and remote enable values at startup to aid support (#8) (@dfinstein)
- docs: remove the old svg banner now the readme uses the png
- chore(deps): dependency updates

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

