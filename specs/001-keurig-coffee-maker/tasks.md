---
description: "Task list for the Keurig K-Cup Brewer feature"
---

# Tasks: Keurig K-Cup Brewer (PYE22PYNHFS)

**Input**: Design documents in `specs/001-keurig-coffee-maker/`

**Prerequisites**: `spec.md` ✅ · `plan.md` ✅ · `research.md` ✅

**Tests**: Tests are included for the `HOT_WATER_STATUS` parser (SC-005) and the decision helper. UI-bound `onGet`/`onSet` wiring is verified by manual checks on the user's hardware.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel with sibling tasks (different files, no dependencies)
- **[Story]**: which user story the task supports (US1–US4) or `INF` for infrastructure

---

## Status — As Shipped

This task list was the *plan*. Here's what actually happened by the time the upstream PR was opened:

**Shipped (Phases 1–4, plus follow-on work):**
- ✅ Phase 1 setup — feature branch off `beta-0.5.0`, baseline green
- ✅ Phase 2 hardware verification — done in parallel with implementation (rather than as a strict gate). All three open questions resolved live; see `research.md` "Hardware Verification".
- ✅ Phase 3 scaffolding — `parseHotWaterStatus()`, `decideKeurigCapability()`, `keurig` config flag, 15 unit tests
- ✅ Phase 4 MVP (US1 + US2) — K-Cup Hot Water Switch, Hot Water Ready, Hot Water Dispensing — hardware-validated

**Plan changes during implementation:**
- ⚠️ **Architecture decision AD-1 reversed.** Originally planned as "inline services in refrigerator.ts." After hardware deployment, Apple Home UX with 15+ services on one accessory was unworkable (generic `Switch 1..4` names, Siri fan-out). Refactored to publish the Keurig as its own peer HomeKit accessory. New file `src/devices/keurig.ts`, dispatch in `platform.ts`. Tasks T030-T035 are obsolete in their original form; equivalent work landed in the keurig.ts split.
- ➕ **Added `keurigOnly` per-device config flag** (not in the original plan). Lets users hide the main Refrigerator accessory entirely while keeping the Keurig sub-accessory. Spec FR-007a documents this.
- ➕ **Stale-service cleanup** in `SmartHQRefrigerator.initializeHAP()` (plan.md AD-6). Removes legacy pre-beta cached services (`Refrigerator Door`, `Fridge Temperature`, `Freezer Temperature`) plus the moved-out Keurig services. Not in the original plan but necessary because of HomeKit's cache persistence.
- ➕ **Two pre-existing bug fixes** found and patched in `src/platform.ts` (shipped in a separate upstream PR):
  - `keyBy(devices)` was missing its iteratee argument, causing every per-device config entry to collapse under one key
  - The discovery loop only copied `hide_device` from config, dropping every other per-device field. Replaced with `Object.assign`.

**Deferred to follow-up PRs:**
- ⏭️ Phase 5: US3 Water Temperature TemperatureSensor — parser already emits `currentTempF`; small follow-up
- ⏭️ Phase 6: US4 Pod / Tank / Fault ContactSensors — parser already emits these; small follow-up
- ⏭️ Phase 7 polish (README, CHANGELOG) — maintainer's call on how/when to document this in the next stable release

---

## Phase 1: Setup

- [ ] **T001** Create feature branch off `beta-0.5.0`: `git checkout beta-0.5.0 && git pull && git checkout -b 001-keurig-coffee-maker`
- [ ] **T002** Drop the stashed probe code — research has obsoleted it. Either `git stash drop` the "fridge ERD probe code" stash now, or hold it briefly for Phase 2 verification and drop after.
- [ ] **T003** [P] Verify `npm run build` and `npm run lint` pass on a clean baseline.

**Checkpoint**: baseline green; branch ready.

---

## Phase 2: Hardware Verification (BLOCKING, ~5 min)

**Purpose**: confirm upstream-documented protocol behaves as expected on the user's PYE22PYNHFS. Resolves OQ-1/OQ-2/OQ-3 from spec.md. **NOT** a multi-state discovery campaign.

- [ ] **T010** [INF] With Homebridge running in debug mode, trigger a single `readErd("0x1010")` against the user's fridge (can be done by reviving the probe code briefly OR by adding a one-shot debug log to refrigerator.ts). Capture the returned hex string into `research.md` under a new heading **Hardware Verification**.
- [ ] **T011** [INF] Validate the captured string: ≥14 hex chars; byte[0:2] in `{00,01,02,FD,FE}`; byte[6:8] parses as plausible °F (typically 60–200 range); byte[12:14] is `00`/`01`/`FF`. Record validation result in `research.md`.
- [ ] **T012** [INF] `readErd("0x1011")` — verify a small integer (`00`, or `5A`–`BE` hex i.e. 90–190 °F).
- [ ] **T013** [INF] **Write test**: `writeErd("0x1011", "BE")` (190 °F). Within 30 seconds, confirm the appliance display shows "heating" (or equivalent indication). Then `writeErd("0x1011", "00")` and confirm it returns to off. Record result in `research.md`.
- [ ] **T014** [INF] Decision gate: if T013 write succeeded → proceed with full plan. If write was rejected → revise spec.md US2 to read-only (display target temp as a sensor, no Switch); revise tasks.md US2 section accordingly; continue with US1/US3/US4 unchanged.

**Exit criterion**: T010–T013 results documented in `research.md`. Decision recorded in T014.

---

## Phase 3: Foundational — Scaffolding (BLOCKING all user stories)

- [ ] **T020** [INF] In `src/settings.ts`, add `keurig?: boolean` to the `devicesConfig` interface. Also add a `HotWaterStatus` interface exporting the parsed struct shape: `{ status: 'NOT_HEATING' | 'HEATING' | 'READY' | 'FAULT_NEED_CLEARED' | 'FAULT_LOCKED_OUT' | 'NA'; timeUntilReadyMinutes: number | null; currentTempF: number | null; tankFull: boolean | null; brewModulePresent: boolean | null; podStatus: 'REPLACE' | 'READY' | 'NA'; faulted: boolean; }`.
- [ ] **T021** [INF] In `src/devices/refrigerator.ts`, add a static or module-level `parseHotWaterStatus(hex: string): HotWaterStatus` helper. Tolerant per FR-005: empty/short/garbage input returns safe defaults with `status: 'NA'` and `faulted: false`. Byte positions per `research.md`.
- [ ] **T022** [INF] In `src/devices/refrigerator.ts`, add a private `async hasKeurig(): Promise<boolean>` method on `SmartHQRefrigerator`. Logic per plan.md AD-2:
    1. If `this.device.keurig === false` → return false.
    2. If `this.device.keurig === true` → return true.
    3. Otherwise: try `readErd(ERD_TYPES.HOT_WATER_STATUS)`, parse, return true iff `status !== 'NA' && podStatus !== 'NA' && brewModulePresent !== null`. On read error → false.
    4. Cache the result on `this` for the accessory lifetime.
- [ ] **T023** [P] [INF] Update `config.schema.json` to expose the per-device `keurig` toggle (boolean, optional) with tooltip: "Enable Keurig K-Cup Hot Water services. Leave unset to auto-detect. Set true/false to override."
- [ ] **T024** [INF] Create `test/devices/refrigerator.test.ts` (or add to existing) with Vitest tests for `parseHotWaterStatus`:
    - Empty string → safe defaults, `status: 'NA'`
    - Short string ("ab") → safe defaults
    - Garbage hex ("zzzzzzzz...") → safe defaults
    - Valid sample (e.g., `"01000ABE010101"` — heating, 10 min, 190°F, full, brew mod present, pod ready) → exact expected struct
    - Fault sample (`"FD..."`) → `faulted: true`
- [ ] **T025** [INF] Run `npm run build && npm run lint && npm test`. Confirm clean.

**Checkpoint**: Foundation ready. A non-Keurig refrigerator still works exactly as before. `hasKeurig()` returns false for it without throwing.

---

## Phase 4: US1 (Status sensors) + US2 (K-Cup switch) — MVP

**Goal**: Ship the two P1 stories together as the MVP. They share the same `HOT_WATER_STATUS` read cadence.

**Independent Test**: Toggle K-Cup switch in HomeKit; appliance heats up; "Hot Water Ready" sensor flips when temperature reached; "Hot Water Dispensing" sensor flips when brew button is pressed.

- [ ] **T030** [US1+US2] In `SmartHQRefrigerator` constructor, after existing services and after awaiting `this.hasKeurig()`, gate the next block on the result. If false, return early from Keurig wiring with one debug log.
- [ ] **T031** [US2] Add `Switch` service "K-Cup Hot Water" with subtype `KeurigKCupSwitch`. Wire `onGet`: `readErd(HOT_WATER_SET_TEMP)`, return `parseInt(value, 16) !== 0`. Wire `onSet`: write `"BE"` (190 hex) for true, `"00"` for false. Error handling per `refrigerator.ts:115-121` pattern.
- [ ] **T032** [US1] Add `OccupancySensor` service "Hot Water Ready" with subtype `KeurigReady`. Wire `onGet`: read `HOT_WATER_STATUS`, parse, return `OCCUPANCY_DETECTED` iff `status === 'READY'`.
- [ ] **T033** [US1] Add `OccupancySensor` service "Hot Water Dispensing" with subtype `KeurigDispensing`. Wire `onGet`: `readErd(HOT_WATER_IN_USE)`, return `parseInt(value, 16) !== 0 ? OCCUPANCY_DETECTED : NOT_DETECTED`.
- [ ] **T034** [US1+US2] Hook into the platform's WebSocket ERD event stream for the three ERDs and push `updateCharacteristic` to each consumer service. Cache the most recent parsed `HotWaterStatus` struct on the device instance for re-use.
- [ ] **T035** [US1+US2] Run `npm run build && npm run lint && npm test`. Manual test on hardware: toggle switch, watch appliance respond; press brew button, watch sensors flip. Record results in `research.md` under **MVP Validation**.

**Checkpoint**: MVP ships. Optional: open PR against `beta-0.5.0` here for early validation before adding US3/US4.

---

## Phase 5: US3 (Temperature sensor)

**Goal**: Read-only TemperatureSensor for the hot-water reservoir.

- [ ] **T040** [US3] Add `TemperatureSensor` service "Keurig Water Temp" with subtype `KeurigWaterTemp`. Wire `CurrentTemperature` `onGet`: use the cached `HotWaterStatus.currentTempF` (set by the WebSocket subscription from Phase 4 T034); convert °F → °C as `(value - 32) * 5 / 9`. On null/NA, return 0 with a debug log.
- [ ] **T041** [US3] When the cached struct updates, push the converted °C to this characteristic.
- [ ] **T042** [US3] Manual sanity check: compare reported value to appliance display; tolerate ±3 °C.

**Checkpoint**: US3 ships.

---

## Phase 6: US4 (Pod / Tank / Fault sensors)

**Goal**: ContactSensors for K-Cup pod and reservoir; OccupancySensor with fault indication.

- [ ] **T050** [US4] Conditional on `cachedStatus.podStatus !== 'NA'` (per OQ-1 result): add `ContactSensor` "K-Cup Pod" with subtype `KeurigPod`. `onGet`: `podStatus === 'REPLACE' ? CONTACT_NOT_DETECTED (open) : CONTACT_DETECTED (closed)`.
- [ ] **T051** [US4] Conditional on `cachedStatus.tankFull !== null`: add `ContactSensor` "Hot Water Tank" with subtype `KeurigTank`. `onGet`: `tankFull ? CONTACT_DETECTED : CONTACT_NOT_DETECTED`.
- [ ] **T052** [US4] Add `OccupancySensor` "Keurig Fault" with subtype `KeurigFault`. `onGet`: `cachedStatus.faulted ? OCCUPANCY_DETECTED : NOT_DETECTED`. Optionally also set `StatusFault` characteristic.
- [ ] **T053** [US4] Push WebSocket updates to all three.
- [ ] **T054** [US4] Manual test: remove pod (Pod sensor opens); drain tank (Tank sensor opens); trigger a fault if reachable (Fault sensor occupies).

**Checkpoint**: US4 ships.

---

## Phase 7: Polish & Release

- [ ] **T060** Update README with a Keurig section: which models, what services appear, the `keurig` config flag, what's NOT supported (no brew-start from API).
- [ ] **T061** Update `CHANGELOG.md` entry for the upcoming `beta-0.5.0` cut.
- [ ] **T062** Run `npm run docs`; address warnings or note known-issue.
- [ ] **T063** Confirm the discovery `probeErds()` code is not present in `refrigerator.ts` (T002 should have removed it). Final grep to be sure.
- [ ] **T064** [P] Final `npm run build && npm run lint && npm test` clean. Open PR against `beta-0.5.0` with the `minor` semver label. PR body: link to `specs/001-keurig-coffee-maker/` and note the `FRIDGE_UNKONWN_1029` typo is intentionally left as-is (inherited from upstream gehome, unrelated to this feature).
- [ ] **T065** After beta validation, the `beta-0.5.0 → latest` merge picks this up per the project's release workflow.

---

## Dependencies & Execution Order

- **Phase 1 (Setup)** → no deps
- **Phase 2 (Hardware Verification)** → depends on Phase 1; blocks Phase 3+
- **Phase 3 (Scaffolding)** → depends on Phase 2 outputs
- **Phase 4 (MVP: US1 + US2)** → depends on Phase 3
- **Phase 5 (US3)** → depends on Phase 4 (uses the cached struct from T034)
- **Phase 6 (US4)** → depends on Phase 4 (same)
- **Phase 7 (Polish)** → depends on whichever user stories shipped

### Within each user story

Service creation → `onGet` wiring → `onSet` wiring (if any) → WebSocket update push → manual hardware test → checkpoint.

### Parallel opportunities

- Tasks marked `[P]` can run together with their siblings.
- Phase 5 (US3) and Phase 6 (US4) are independent of each other after Phase 4; a team of two devs could parallelize.

## Notes

- **Per CLAUDE.md**, never target a PR at `latest` directly. Always `beta-0.5.0` first.
- **Semver label**: `minor` (new HomeKit-visible functionality, no breaking changes).
- **Commit cadence**: one commit per phase is fine for `[INF]` tasks; bundle the user-story tasks into a single coherent commit per story.
- **Reference implementation**: `simbaja/ha_gehome` `ge_kcup_switch.py` and `ge_dispenser.py` are the authoritative pattern. Diverge only with reason.
- **Source of truth for ERD semantics**: `research.md` in this directory. If reviewers ask "how do you know HOT_WATER_STATUS bytes mean X", that file answers it.
