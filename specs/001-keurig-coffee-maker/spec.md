# Feature Specification: Keurig K-Cup Brewer (PYE22PYNHFS Refrigerator)

**Feature Branch**: `001-keurig-coffee-maker`

**Created**: 2026-05-24

**Status**: Draft (revised after Phase 0 research)

**Input**: User description: "Get the Keurig coffee maker built into the GE PYE22PYNHFS refrigerator visible and controllable through Apple Home via Homebridge."

## Context

The GE Profile PYE22PYNHFS is a counter-depth French-door refrigerator with a built-in single-serve Keurig K-Cup brewing system that draws filtered water from the fridge's water line. The SmartHQ API already exposes this fridge as `device.type === 'Refrigerator'`, and `src/devices/refrigerator.ts` wires up doors, temperatures, ice maker, and turbo modes — but the Keurig hot-water/brewing surface is unrepresented.

Phase 0 research (see `research.md`) established that the protocol is **already fully decoded** by the `simbaja/gehome` Python SDK and exposed in production by `simbaja/ha_gehome`. The three ERDs already present in `src/settings.ts` (`HOT_WATER_STATUS=0x1010`, `HOT_WATER_SET_TEMP=0x1011`, `HOT_WATER_IN_USE=0x1018`) are the complete Keurig surface. Critically, the protocol has **no "brew start" command** — the brew button is hardware-only. What the API does provide is heater enable/disable (write `HOT_WATER_SET_TEMP`) plus a rich packed status struct.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — See Keurig hot-water status at a glance (Priority: P1) MVP

The user opens the Home app and can see whether the Keurig hot water is heating, ready, idle, or in a fault/attention state. They can also see whether water is actively being dispensed.

**Why this priority**: Highest-value observability with the lowest implementation risk. Every signal comes from one `readErd(0x1010)` plus `readErd(0x1018)`. Enables automations like "notify me when the water is ready" and "quiet the kitchen speaker while a brew is dispensing."

**Independent Test**: Push the brew button on the appliance; HomeKit accessory for "Hot Water Dispensing" transitions to occupied within `updateRate` (default 5s). When the unit heats up after being off, the "Hot Water Ready" accessory transitions to occupied.

**Acceptance Scenarios**:

1. **Given** the heater is off and cold, **When** the user opens Home app, **Then** "Hot Water Ready" shows unoccupied and "Hot Water Dispensing" shows unoccupied.
2. **Given** the user starts a brew on the physical appliance, **When** brewing begins, **Then** "Hot Water Dispensing" transitions to occupied within 5 seconds.
3. **Given** the heater reaches brewing temperature, **When** status changes to READY, **Then** "Hot Water Ready" transitions to occupied.
4. **Given** the appliance enters a fault state, **When** Home app polls, **Then** a fault indication is visible.

---

### User Story 2 — Enable/disable Keurig hot water from Apple Home (Priority: P1) MVP

The user toggles a Switch ("K-Cup Hot Water") in HomeKit. Switching on writes `HOT_WATER_SET_TEMP = 190 °F` (the K-Cup brewing temperature); switching off writes `0` (heater disabled). The appliance then heats up over several minutes; the user can return when status flips to READY (US1) and press the physical brew button.

**Why this priority**: Replaces the originally-planned "start a brew from HomeKit" story, which research established is infeasible. This is arguably more useful because the heater takes minutes to come up to temperature — a HomeKit automation can preheat the water before the user reaches the kitchen ("Every weekday at 6:55am, turn on K-Cup Hot Water"). Direct port of `simbaja/ha_gehome`'s `GeKCupSwitch` pattern, which has been in production for years.

**Independent Test**: Toggle the K-Cup switch in HomeKit; observe the appliance's display reflect "heating" within seconds. Toggle off; observe the display reflect "off" within seconds.

**Acceptance Scenarios**:

1. **Given** the heater is off, **When** the user turns the K-Cup switch on in Home app, **Then** the appliance begins heating within 5 seconds and the switch state in HomeKit stays "on".
2. **Given** the heater is on, **When** the user turns the switch off, **Then** the appliance heater turns off and the switch state in HomeKit stays "off".
3. **Given** the heater was enabled outside HomeKit (e.g., from the SmartHQ phone app), **When** HomeKit refreshes, **Then** the switch reflects the actual state — not stuck off.
4. **Given** a write fails (network blip, appliance rejection), **When** the user toggles, **Then** the switch reverts to actual state and a warning is logged.

---

### User Story 3 — Read Keurig water temperature (Priority: P2)

The user sees current hot-water reservoir temperature as a TemperatureSensor in HomeKit.

**Why this priority**: Useful for automations and at-a-glance visibility but lower priority than US1/US2 because the same information is implicitly conveyed by the "Hot Water Ready" sensor (US1).

**Independent Test**: Watch the value rise after enabling the heater (US2). Compare to the appliance's own display.

**Acceptance Scenarios**:

1. **Given** the heater is off and cold, **When** HomeKit polls, **Then** a value below brewing temp is reported (e.g., 70–80 °F → 21–27 °C).
2. **Given** the heater is at ready, **When** HomeKit polls, **Then** a value near 190 °F (≈88 °C) is reported.

---

### User Story 4 — K-Cup pod and reservoir attention sensors (Priority: P3)

The user gets HomeKit ContactSensor states for "K-Cup Pod" (open=needs replacement) and "Hot Water Tank" (open=empty), plus a fault indicator.

**Why this priority**: Nice-to-have. Useful for "refill water" reminders. Apple Home's attention surface for ContactSensors is decent (door-open-style notifications).

**Independent Test**: Remove the K-Cup pod from the appliance; the K-Cup Pod ContactSensor opens. Reload pod; closes. Drain the reservoir; Hot Water Tank ContactSensor opens.

**Acceptance Scenarios**:

1. **Given** no K-Cup pod is loaded, **When** HomeKit polls, **Then** "K-Cup Pod" ContactSensor is open (attention).
2. **Given** the reservoir is empty, **When** HomeKit polls, **Then** "Hot Water Tank" ContactSensor is open.
3. **Given** the appliance reports `FAULT_LOCKED_OUT` or `FAULT_NEED_CLEARED`, **When** HomeKit polls, **Then** a fault state is visible.

---

### Edge Cases

- The user has a refrigerator without a Keurig (the majority of `Refrigerator` accessories). Detection: a single `readErd(0x1010)` returning `NA` status → no Keurig services added.
- The user explicitly disables Keurig via per-device config flag (`keurig: false`) even on a PYE22PYNHFS — services must not be created.
- The heater is enabled outside HomeKit (SmartHQ phone app, button on the appliance). The K-Cup switch in HomeKit must reflect that state on the next status update.
- SmartHQ WebSocket disconnects. State reconciles when polling resumes.
- The `HOT_WATER_STATUS` ERD returns a malformed/short payload. Parser must not throw — return safe defaults and warn.
- User has multiple PYE22-series fridges on the same account. Each gets its own independent Keurig accessory.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Plugin MUST detect whether a given `Refrigerator` device has Keurig functionality via a single `readErd(HOT_WATER_STATUS)` call at startup. Detection signal: `status != NA` (matching ha_gehome's `devices/fridge.py`; the stricter check including `pod_status != NA` and `brew_module != NA` was discarded after live capture showed the PYE22PYNHFS reports `brew_module = 0x03`, outside gehome's documented enum). Detection runs at the platform dispatch level, before the Keurig accessory is created.
- **FR-002**: Plugin MUST expose, at minimum, the K-Cup Hot Water enable Switch (US2) and the Hot Water Dispensing OccupancySensor (US1).
- **FR-003**: Plugin MUST react to WebSocket ERD broadcasts for `HOT_WATER_STATUS` (`0x1010`) and `HOT_WATER_IN_USE` (`0x1018`) and update relevant HomeKit characteristics within `updateRate` (default 5s) without dedicated polling.
- **FR-004**: The K-Cup Hot Water switch MUST write `HOT_WATER_SET_TEMP = 190` (°F, hex `BE`) on enable and `0` (hex `00`) on disable. Reads of the switch state derive from whether `HOT_WATER_SET_TEMP != 0`.
- **FR-005**: A parser MUST decode the packed 7-byte `HOT_WATER_STATUS` payload into: `status` enum, `time_until_ready` minutes, `current_temp` °F, `tank_full` bool, `brew_module` enum, `pod_status` enum. On short/malformed input, return safe defaults and log a warning — never throw.
- **FR-006**: Plugin MUST log all reads/writes to Keurig ERDs at debug level, and MUST log a single info-level line at startup describing detected Keurig capability.
- **FR-007**: Configuration schema (`config.schema.json`) MUST expose a per-device `keurig` toggle (`true`/`false`/unset). `unset` = auto-detect via FR-001; `false` = forcibly skip Keurig wiring; `true` = forcibly enable wiring (useful if auto-detect proves unreliable on some firmware).
- **FR-007a** *(added during implementation)*: Configuration schema MUST also expose a per-device `keurigOnly` toggle. When `true` on a refrigerator with Keurig, the main Refrigerator HomeKit accessory is skipped; only the Keurig sub-accessory is published. Independent of `hide_device` (which still hides everything). Use case: users who only care about coffee don't want 15 fridge tiles in Apple Home.
- **FR-008**: Plugin MUST NOT regress any existing refrigerator behavior (door, temp sensors, ice maker, turbo modes) when the Keurig path is added.
- **FR-009**: Plugin MUST handle the `FRIDGE_UNKONWN_1029` typo in `settings.ts` carefully: do not rename in this feature (the constant is inherited from upstream gehome and unrelated to Keurig). A separate cleanup is out of scope.
- **FR-010**: Temperature values exposed to HomeKit MUST be in °C (HomeKit's expected unit). Conversion from °F is `(°F - 32) × 5 / 9`, matching the existing `refrigerator.ts:55-58` pattern.

### Key Entities

- **KeurigFridge**: a `Refrigerator` device for which FR-001 detection returned positive. Surfaced in HomeKit as a **separate accessory** (`<nickname> Keurig`, UUID derived from `${applianceId}-keurig`) — see plan.md AD-1 for the rationale (Apple Home UX problem with many services on one accessory).
- **HotWaterStatus** (in-memory only): the parsed 7-byte struct from `HOT_WATER_STATUS`. Used as the source for the OccupancySensor states; will also feed US3/US4 derived sensors when those ship.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: User can toggle the K-Cup Hot Water switch in Apple Home; appliance reflects the change within 5 seconds, ≥95% success across ≥10 trials (US2).
- **SC-002**: User can see hot-water dispensing state in Apple Home within 5 seconds of physical state change (US1).
- **SC-003**: Existing refrigerator services show no regression — door, temp sensors, ice maker, turbo modes all continue to read/write correctly.
- **SC-004**: Plugin handles a non-Keurig refrigerator without errors — no Keurig services exposed, no warnings beyond one info-level "no Keurig detected" line.
- **SC-005**: `HOT_WATER_STATUS` parser handles malformed input (empty string, short string, garbage hex) without throwing — verified by unit test.

## Open Questions — Resolved Live

All three resolved during hardware testing on the user's PYE22PYNHFS. See `research.md` "Hardware Verification" for raw payloads.

- ~~**OQ-1**: Is `pod_status` reliably populated?~~ → **Yes**, byte 12-13 reports `01` (READY) with a K-Cup loaded.
- ~~**OQ-2**: Does the SmartHQ Brillion endpoint accept writes to `HOT_WATER_SET_TEMP`?~~ → **Yes**. Writing `'BE'` (190 °F) starts heating; writing `'00'` disables.
- ~~**OQ-3**: Temperature byte encoding?~~ → **Raw °F as uint8**. 0xBE = 190 °F confirmed. Conversion to HomeKit's °C handled by FR-010.

One new finding worth noting: **`brew_module` byte returns `0x03`** on this model — outside gehome's documented `ErdPresent` enum. We work around it by relaxing detection to only check `status != NA` (matches ha_gehome). See `research.md` for full discussion and a list of issues worth filing upstream against gehome.

## Assumptions

- The `simbaja/gehome` protocol decoding has been validated in production by ha_gehome users for years and is reliable for this appliance class.
- Per CLAUDE.md, the feature ships against `beta-0.5.0` first with a `minor` semver label.
- The user is the primary tester; reviewer trust will rely on logs/screenshots from their PYE22PYNHFS.
- HeaterCooler as an alternative to Switch + TemperatureSensor is rejected for v1 — the binary "off vs 190 °F" model doesn't fit HeaterCooler's heating/cooling/auto axis cleanly. Revisit in a future feature if continuous temperature control proves useful.
