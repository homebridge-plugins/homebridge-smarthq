# Implementation Plan: Keurig K-Cup Brewer

**Branch**: `001-keurig-coffee-maker` | **Date**: 2026-05-24 | **Spec**: [./spec.md](./spec.md) | **Research**: [./research.md](./research.md)

## Summary

Add HomeKit visibility and partial control of the Keurig brewer built into the GE PYE22PYNHFS refrigerator. Implementation is straightforward because the protocol is already decoded by `simbaja/gehome` (see `research.md`): three ERDs (`HOT_WATER_STATUS=0x1010` packed struct, `HOT_WATER_SET_TEMP=0x1011` writable °F, `HOT_WATER_IN_USE=0x1018` boolean) cover everything. We extend the existing `SmartHQRefrigerator` class with optional Keurig services that activate when a runtime detection signal indicates Keurig capability.

## Technical Context

**Language/Version**: TypeScript 5.x, Node 18+ (Homebridge runtime).

**Primary Dependencies**: `homebridge` API (Service/Characteristic), `axios` (REST to SmartHQ Brillion API), `rxjs` (intervals + WebSocket fanout), existing `deviceBase` from `src/devices/device.ts`.

**Storage**: None — runtime state only. ERD codes are constants in `src/settings.ts`.

**Testing**: Vitest (`npm test`). New unit tests for the `HOT_WATER_STATUS` parser (FR-005, SC-005) and for the detection helper.

**Target Platform**: Homebridge plugin (Node.js on any Homebridge-supported platform).

**Project Type**: Library / Homebridge dynamic platform plugin.

**Performance Goals**: HomeKit state freshness within `updateRate` (default 5s). No new polling — rely on WebSocket pushes plus the existing fridge refresh interval.

**Constraints**:
- Must not regress non-Keurig refrigerators (the majority of users).
- Must follow the project's branch & PR workflow: target `beta-0.5.0` first with a `minor` semver label.
- `HOT_WATER_STATUS` parser must be tolerant of short/malformed input (FR-005).

**Scale/Scope**: One new device variant on an existing class. Estimated ~150–250 LOC added across `refrigerator.ts`, `settings.ts`, `config.schema.json`, and one new test file.

## Constitution Check

The project constitution at `.specify/memory/constitution.md` is the default spec-kit placeholder; no project-specific gates are codified. No violations to track. (Recommend a separate future task to run `/speckit-constitution` and document the project's actual rules — semver labels, beta-branch-first, the no-unprompted-comments style from CLAUDE.md — but that is not blocking.)

## Architecture Decisions

### AD-1 — Expose Keurig as its **own** HomeKit accessory (peer to Refrigerator)

**Originally** the plan was to extend `refrigerator.ts` inline (one accessory, many services). That was implemented and worked at the HAP level, but Apple Home's UI made it unusable in practice: with ~15 services on one accessory (4 switches, 6 contact sensors, etc.), iOS labels every tile generically (`Switch 1..4`, `Contact Sensor 1..N`) regardless of the service `Name` characteristic that Homebridge sets correctly. Renaming individual tiles in Apple Home was also ineffective for disambiguating Siri ("turn on hot water" toggled all four switches on the fridge because Siri fans out within an accessory when service names are ambiguous).

**Reversed decision**: ship the Keurig as a separate HomeKit accessory (`<nickname> Keurig`) with a UUID derived from `${applianceId}-keurig`. Same underlying ERDs (the platform's authenticated axios reaches them via the parent appliance's ID), different HAP shape. Apple Home then renders the small accessory cleanly, names propagate normally, and "Hey Siri, turn on the Keurig" addresses the right switch unambiguously.

Cost: a new device class (`src/devices/keurig.ts`) plus a dispatch method (`createSmartHQKeurig`) in `platform.ts`. About 150 LOC, no manager-style scaffolding required.

### AD-2 — Detection via single `readErd(0x1010)` at the **platform** level

`research.md` established that `HOT_WATER_STATUS != NA` is the canonical "this fridge has a hot-water dispenser" signal — mirrors ha_gehome `devices/fridge.py` exactly. Note the relaxed test versus the spec's earlier draft: pod and brew_module bytes are *not* part of the gate (live capture showed the PYE22PYNHFS returns `brew_module = 0x03`, outside gehome's documented enum, so requiring it would miss real Keurig fridges).

Detection runs in `createSmartHQKeurig` *before* the accessory is created — uses the platform's authenticated `axios.get(/appliance/<id>/erd/0x1010)`. This means a non-Keurig fridge never gets an empty Keurig accessory in HomeKit.

Config override via `devicesConfig.keurig: boolean | undefined`:
- `undefined` (default) → auto-detect.
- `false` → forcibly skip Keurig accessory.
- `true` → forcibly create it (escape hatch for firmware variants we haven't seen).

### AD-3 — K-Cup On/Off via writing `HOT_WATER_SET_TEMP`

Confirmed live: writing `'BE'` (hex for 190 °F) enables the heater; writing `'00'` disables. Same pattern as ha_gehome `GeKCupSwitch`. `onGet` returns `parseInt(value, 16) !== 0`. Hardware round-trip ≤ 5 s.

### AD-4 — `keurigOnly` per-device flag

A new per-device config flag, distinct from `hide_device`. Use case: users who only care about coffee and don't want 12 other HomeKit tiles for the fridge's doors/thermostats/ice maker.

- `hide_device: true` — hide the entire SmartHQ device (both Refrigerator and Keurig accessories).
- `keurigOnly: true` — skip the main Refrigerator accessory, publish only the Keurig sub-accessory.

The two are independent: `hide_device: true` wins (hides everything).

### AD-5 — HomeKit service mapping (v1 scope on the Keurig accessory)

| Capability | HomeKit Service | Source | Subtype |
|------------|----------------|--------|---------|
| K-Cup Hot Water enable | `Switch` | r/w `HOT_WATER_SET_TEMP` (190/0) | `KeurigKCupSwitch` |
| Hot water ready | `OccupancySensor` | `HOT_WATER_STATUS.status == READY` | `KeurigReady` |
| Currently dispensing | `OccupancySensor` | `HOT_WATER_IN_USE` | `KeurigDispensing` |

User stories US3 (water temperature `TemperatureSensor`) and US4 (pod / tank / fault `ContactSensor`s) from the spec are **deferred to a follow-up PR** — the parser is already complete and the ERDs return live values, so adding them is small. Held back to keep the initial PR focused.

`HeaterCooler` was considered and rejected — see spec.md Assumptions. Two `OccupancySensor` instances (ready + dispensing) use distinct subtypes so Apple Home keeps them separate.

### AD-6 — Stale-service cleanup on the Refrigerator accessory

When the `beta-0.5.0` refactor restructured the Refrigerator (new multi-door support, thermostat services for fridge/freezer, etc.), the pre-beta services it replaced were never removed from users' HomeKit caches — they lingered as orphan tiles indefinitely. Plus, this PR moves three Keurig services off the Refrigerator that earlier dev iterations had added.

`SmartHQRefrigerator`'s `initializeHAP()` now removes a hardcoded list of six legacy services on startup: `Refrigerator Door`, `Fridge Temperature`, `Freezer Temperature`, `K-Cup Hot Water`, `Hot Water Ready`, `Hot Water Dispensing`. One-time cleanup; safe to leave in place for future restarts as a no-op.

## Project Structure

### Documentation (this feature)

```text
specs/001-keurig-coffee-maker/
├── spec.md             # Feature spec (revised post-research)
├── plan.md             # This file
├── research.md         # Phase 0 output (already complete from upstream)
├── data-model.md       # NOT NEEDED — research.md already documents the ERD struct
└── tasks.md            # Task breakdown
```

No `data-model.md` is generated because `research.md` already documents the only "model" (the `HOT_WATER_STATUS` packed struct) authoritatively.

### Source Code (repository root) — as implemented

```text
src/
├── devices/
│   ├── keurig.ts                # NEW: SmartHQKeurig device class, parser
│   │                            #      (parseHotWaterStatus), and decision
│   │                            #      helper (decideKeurigCapability)
│   ├── keurig.test.ts           # NEW: 15 unit tests for parser + decision
│   └── refrigerator.ts          # EDIT: stale-service cleanup (AD-6); no
│                                #       Keurig wiring here (it's on the
│                                #       new accessory instead)
├── settings.ts                  # EDIT: add `keurig?: boolean` and
│                                #       `keurigOnly?: boolean` to
│                                #       devicesConfig; add HotWaterStatus
│                                #       interface + Erd* string-literal types
├── platform.ts                  # EDIT: dispatch createSmartHQKeurig after
│                                #       createSmartHQRefrigerator for any
│                                #       'Refrigerator' device; respect
│                                #       keurigOnly to skip the main fridge
└── homebridge-ui/               # NO CHANGES

config.schema.json               # EDIT: per-device `keurig` and `keurigOnly`
                                 #       toggles (description in the UI)

src/devices/refrigerator.test.ts # (Removed — became keurig.test.ts; the parser
                                 #  and decision function moved to keurig.ts)
```

**Structure Decision**: Single-project layout (existing). No new device subdirectory.

## Phase Plan

### Phase 0 — Research (COMPLETE)

`research.md` is written and captures the full protocol from upstream `simbaja/gehome` / `simbaja/ha_gehome`. No further upstream research required.

### Phase 1 — Hardware verification (BLOCKING, ~5 minutes)

Goal: confirm the upstream-documented protocol behaves as expected on the user's actual PYE22PYNHFS before code is written. Resolves spec.md OQ-1/OQ-2/OQ-3.

This is **NOT** a multi-state log-capture campaign. It is three quick checks:

1. **Read `HOT_WATER_STATUS`** once. Verify the response is a hex string ≥14 chars and parses into a sensible struct (e.g., status byte is one of `00`/`01`/`02`/`FD`/`FE`, current_temp byte is plausibly °F).
2. **Read `HOT_WATER_SET_TEMP`**. Verify it returns a small integer (0 or 90–190).
3. **Write `HOT_WATER_SET_TEMP = 190` then watch the appliance display.** Verify within 30 seconds the appliance shows "heating" or equivalent. Then write `0` and verify it returns to off.

Exit criterion: all three checks pass. If write rejects, US2 degrades to read-only (target temp display sensor); document in tasks.md as a contingency.

### Phase 2 — Foundational (BLOCKING all user stories)

Steps:

1. Add `HotWaterStatus` interface + `parseHotWaterStatus(hex: string): HotWaterStatus` helper. Tolerant parser per FR-005.
2. Add `keurig?: boolean` to `devicesConfig` in `settings.ts` and to `config.schema.json`.
3. Implement private `async hasKeurig(): Promise<boolean>` on `SmartHQRefrigerator` per AD-2.
4. Add unit tests for parser + detection helper.

Exit criterion: `npm run build && npm run lint && npm test` clean. Non-Keurig fridge produces zero Keurig services with at most one info log.

### Phase 3 — US1 (read-only status) + US2 (K-Cup switch) — MVP

US1 and US2 ship together as a single MVP commit. They share the same `HOT_WATER_STATUS` read cadence and most of the wiring code. P1 + P1 = first deliverable.

### Phase 4 — US3 (temperature sensor)

After MVP validation on hardware.

### Phase 5 — US4 (pod / tank / fault sensors)

After US3. Lowest priority; uses the already-parsed struct from US1.

### Phase 6 — Polish & release

README update, CHANGELOG entry, remove the discovery `probeErds()` code from `refrigerator.ts`, open PR against `beta-0.5.0`.

## Complexity Tracking

No constitution violations. The deliberately-simple inline-services pattern is chosen over the more complex manager pattern (AD-1).

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `HOT_WATER_SET_TEMP` writes rejected by SmartHQ for this appliance | Low | US2 degrades to read-only | Resolves at Phase 1; if rejected, ship read-only target-temp sensor and update spec |
| `pod_status` byte returns NA on this firmware | Medium | Drop K-Cup Pod ContactSensor only | Detect at runtime; conditional service registration |
| Packed struct payload format differs from gehome's documentation | Low | Parser produces wrong values | FR-005 tolerant parser + manual sanity check during Phase 1 |
| Two `OccupancySensor` instances confused by Apple Home | Low | UX glitch | Distinct subtypes per AD-4 |
| Inheriting the `FRIDGE_UNKONWN_1029` typo gives reviewers something to flag | Low | Nuisance PR comments | Note in PR description: typo is intentional, inherited from upstream gehome; out-of-scope cleanup |
| User is the only PYE22PYNHFS tester | High | Quality risk for non-PYE22 owners | Comprehensive non-Keurig fridge regression check (SC-003/SC-004) |
