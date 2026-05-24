# Research Findings — Phase 0

**Status**: Complete (from upstream sources). Hardware verification still recommended but no longer the bottleneck.

**Date**: 2026-05-24

## Summary

The Keurig protocol is already **fully decoded** by the upstream `simbaja/gehome` Python SDK and exposed by `simbaja/ha_gehome` (Home Assistant integration). The three "Keurig" ERD constants currently in `src/settings.ts` were inherited verbatim from gehome — **including the `FRIDGE_UNKONWN_1029` typo**. We do not need to run hardware probes to learn what these ERDs mean; we need to verify the upstream-documented behavior on the user's PYE22PYNHFS and translate it to HomeKit.

## Confirmed ERD Map (from `simbaja/gehome`)

### `HOT_WATER_STATUS` — `0x1010` (READ ONLY)

Packed multi-byte payload. Hex-string positions (each byte = 2 hex chars):

| Bytes | Meaning | Encoding |
|-------|---------|----------|
| `[0:2]` | Status enum | `00`=NOT_HEATING, `01`=HEATING, `02`=READY, `FD`=FAULT_NEED_CLEARED, `FE`=FAULT_LOCKED_OUT |
| `[2:6]` | Time until ready | uint16, **minutes** |
| `[6:8]` | Current water temp | uint8, **°F** |
| `[8:10]` | Reservoir tank full | `00`=NOT_FULL, `01`=FULL |
| `[10:12]` | Brew module present | enum (NA when no Keurig) |
| `[12:14]` | K-Cup pod status | `00`=REPLACE (no pod / spent pod), `01`=READY (pod loaded), `FF`=NA |

Source: `gehomesdk/erd/converters/fridge/hot_water_status_converter.py`, `.../values/fridge/erd_hot_water_status.py`, `.../erd_pod_status.py`, `.../erd_full_not_full.py`.

### `HOT_WATER_SET_TEMP` — `0x1011` (READ + **WRITE**)

Single integer °F. Writable. Range **90 °F to 190 °F** for valid heating; `0` is the "off" sentinel (heater disabled).

Notes from ha_gehome (`ge_dispenser.py`):
> "Values are from `FridgeHotWaterFragment.smali` in the android app (in imperial units). However, the k-cup temperature max appears to be 190. Since there doesn't seem to be any difference between normal heating and k-cup heating based on what I see in the app, we will just set the max temp to 190 instead of the 185"

So the same ERD controls both general hot-water dispensing and K-Cup brewing. There is **no separate K-Cup-only mode** — turning the heater on at 190 °F enables K-Cup brewing temperature.

### `HOT_WATER_IN_USE` — `0x1018` (READ ONLY)

Boolean. True while hot water is actively dispensing (a brew or general dispense is in progress).

### What's missing from the protocol

**There is no "start brew" command ERD.** The K-Cup brew button is a hardware action; the SmartHQ API only exposes the heater enable/disable plus status. This is a **firm constraint, not a discovery gap** — confirmed by reading both gehome and ha_gehome source.

## How ha_gehome Exposes This (the reference implementation)

`custom_components/ge_home/devices/fridge.py` adds a Keurig-aware bundle of entities when `HOT_WATER_STATUS.status != NA`. Source-of-truth entity list:

1. **`GeKCupSwitch`** — a Switch entity. On = write `HOT_WATER_SET_TEMP = 190` (°F). Off = write `HOT_WATER_SET_TEMP = 0`. Icon: `mdi:coffee-maker`. This is their "make the Keurig usable from the app" control.
2. **`GeDispenser`** — a HA WaterHeater entity:
   - `current_temperature` from `HOT_WATER_STATUS.current_temp`
   - `target_temperature` read/write `HOT_WATER_SET_TEMP`
   - Min 90 °F, max 190 °F
   - Operation modes: Normal / Sabbath (`SABBATH_MODE` ERD)
   - Extra attributes: pod_status, tank_full, time_until_ready, fault_status
3. **Diagnostic sensors**:
   - `HOT_WATER_IN_USE` → BinarySensor ("hot water flowing now")
   - `HOT_WATER_SET_TEMP` → Sensor (numeric °F)
   - `HOT_WATER_STATUS.status` → Sensor (string enum)
   - `HOT_WATER_STATUS.time_until_ready` → Sensor (timer)
   - `HOT_WATER_STATUS.current_temp` → Sensor (temperature)
   - `HOT_WATER_STATUS.faulted` → BinarySensor (PROBLEM device class)

### Detection signal used by ha_gehome

```python
# from devices/fridge.py
hot_water_status = self.try_get_erd_value(ErdCode.HOT_WATER_STATUS)
if hot_water_status and hot_water_status.status != ErdHotWaterStatus.NA:
    # ... add dispenser entities including GeKCupSwitch
```

And from `ge_dispenser.py`:
```python
@property
def supports_k_cups(self) -> bool:
    status = self.hot_water_status
    return status.pod_status != ErdPodStatus.NA and status.brew_module != ErdPresent.NA
```

So detection is two-tier:
- "Has a hot-water dispenser" = `HOT_WATER_STATUS.status != NA`
- "Has K-Cup brewing" = additionally `pod_status != NA AND brew_module != NA`

This is the robust feature-detection signal mentioned in plan.md FR-001 — and it doesn't require `device.features` inspection at all. **A single `readErd(0x1010)` answers the question.**

## Implications for Our Spec / Plan / Tasks

### What changes

1. **Phase 0 (Discovery) is largely complete.** We can drop the multi-state log-capture protocol. Verification on the user's PYE22PYNHFS becomes a single sanity check: confirm `HOT_WATER_STATUS` returns a non-NA value with the expected packed structure.
2. **User Story 2 ("Start a brew from HomeKit") is INFEASIBLE.** No brew-start ERD exists. Replace with a "K-Cup Hot Water" enable switch (the ha_gehome `GeKCupSwitch` pattern) — write 190 °F to enable, 0 to disable. **This is arguably more useful** because the heater takes minutes to come up to temperature; an automation that preheats at 7am means the water is ready when the user gets to the kitchen.
3. **Detection is simpler than planned.** Drop the `device.features` inspection. Use a single `HOT_WATER_STATUS` read at startup; if it's non-NA, expose Keurig services.
4. **Existing ERD constants are fine as-is.** No renames needed. We add the new `SABBATH_MODE` ERD (used by ha_gehome's operation mode) only if we want sabbath-mode support — out of scope for v1.
5. **The `FRIDGE_UNKONWN_1029` typo is inherited from upstream.** Fixing it in our plugin would silently diverge; either fix-and-document, or leave it.
6. **No further reverse-engineering is needed for v1.** All of US1, US3, US4, and the revised US2 ("K-Cup Hot Water enable") can be implemented purely from gehome's documented protocol.

### What stays the same

- Branch & PR workflow (target `beta-0.5.0`, `minor` label).
- Architecture decision to extend `refrigerator.ts` rather than build a manager scaffold.
- Per-device config override (`keurig?: boolean`) is still useful as an escape hatch in case auto-detect misfires on a non-Keurig fridge that happens to return a non-NA `HOT_WATER_STATUS` (unlikely but cheap to provide).
- HomeKit service mapping needs revision (see proposed updates below).

## Revised HomeKit Service Mapping (PROPOSED)

| Capability | HomeKit Service | Source | Notes |
|------------|----------------|--------|-------|
| K-Cup Hot Water (on/off) | `Switch` ("K-Cup Hot Water") | write `HOT_WATER_SET_TEMP` (190 / 0) | Direct port of `GeKCupSwitch`. The MVP control. |
| Hot water ready | `OccupancySensor` ("Hot Water Ready") | derive from `HOT_WATER_STATUS.status == READY` | Automatable: "notify me when water is ready". |
| Currently dispensing | `OccupancySensor` ("Hot Water Dispensing") | `HOT_WATER_IN_USE` | Useful for "quiet the kitchen while brewing" automations. |
| Water temperature | `TemperatureSensor` ("Keurig Water Temp") | `HOT_WATER_STATUS.current_temp` (°F → °C) | Read-only sensor. |
| Time until ready | (none in HomeKit) | `HOT_WATER_STATUS.time_until_ready` | Log only; no direct HomeKit characteristic fits. |
| K-Cup pod loaded | `ContactSensor` ("K-Cup Pod") | `HOT_WATER_STATUS.pod_status` | OPEN = REPLACE, CLOSED = READY. Surfaces "needs new pod". |
| Reservoir empty | `ContactSensor` ("Hot Water Tank") | `HOT_WATER_STATUS.tank_full` | OPEN = empty, CLOSED = full. |
| Fault | `OccupancySensor` ("Keurig Fault") with `StatusFault` | `HOT_WATER_STATUS.faulted` | Surface lockouts. |

Alternative for the temperature: use `HeaterCooler` (writable target via `HOT_WATER_SET_TEMP`) instead of separate Switch+TemperatureSensor. Pro: richer Apple Home UI. Con: HeaterCooler is opinionated (heating/cooling/auto modes) and may be awkward for a binary "off vs 190 °F" model. **Recommendation: stick with Switch + TemperatureSensor for v1.**

## Open Questions Now Resolved

- ~~Which ERDs are Keurig-related on PYE22PYNHFS?~~ → `HOT_WATER_STATUS`, `HOT_WATER_SET_TEMP`, `HOT_WATER_IN_USE` (already in `settings.ts`). The `FRIDGE_UNKNOWN_*` codes are not Keurig.
- ~~Is `device.features` populated with Keurig flags?~~ → Use `HOT_WATER_STATUS` read instead; better signal.
- ~~Can we start a brew from the API?~~ → **No.** Hardware button only. Replace with K-Cup Hot Water enable.
- ~~Final HomeKit service mapping?~~ → See table above.

## Hardware Verification — Live Findings on PYE22PYNHFS

Verified during MVP rollout. All confirmed on a single physical appliance; broader-firmware coverage TBD as other users test the plugin.

### Captured ERD payloads

Two representative reads of `HOT_WATER_STATUS` (`0x1010`) from the appliance:

| State | Raw hex | Decoded |
|-------|---------|---------|
| Idle, post-brew | `00000086010301` | `NOT_HEATING`, time=0, **temp=0x86 = 134 °F**, tank=FULL, brew_module=**0x03**, pod=READY |
| Heating, mid-cycle | `0100808B010301` | `HEATING`, time=128, **temp=0x8B = 139 °F**, tank=FULL, brew_module=**0x03**, pod=READY |
| Heating, ~85 s later | `01002BA4010301` | `HEATING`, time=43, **temp=0xA4 = 164 °F**, tank=FULL, brew_module=**0x03**, pod=READY |

### Resolutions to open questions

- **OQ-1: Is `pod_status` reliably populated?** → **YES**, byte 12-13 reports `01` (READY) with a K-Cup loaded, switches to `00` (REPLACE) after a brew. Reliable signal.
- **OQ-2: Does the API accept writes to `HOT_WATER_SET_TEMP`?** → **YES**, confirmed live. Writing `'BE'` (190 °F hex) starts heating; writing `'00'` disables. Status byte transitions `00 → 01 → 02` over ~2 minutes as expected.
- **OQ-3: Temperature byte encoding?** → **Raw °F as uint8**. 0xBE encodes 190 °F exactly, 0x86 = 134 °F observed live. Use `(°F − 32) × 5 / 9` for HomeKit conversion.

### Two model-specific quirks worth flagging to upstream gehome

1. **`brew_module` byte returns `0x03`** on this appliance, outside gehome's documented `ErdPresent` enum (`PRESENT=01`, `NOT_PRESENT=00`, `NA=FF`). gehome's converter would catch this as `NA` via its try/except. Either a firmware quirk, a model variant, or undocumented states. Our detection ignores this byte for capability determination (matches ha_gehome's broader `status != NA` check). **Worth filing as a gehome issue for protocol documentation.**

2. **`time_until_ready` is in seconds, not minutes.** gehome's `HotWaterStatusConverter` decodes this field as `timedelta(minutes=...)`. Live observations contradict that: over an 85-second window the field decreased from 128 to 43 — almost exactly one unit per second, not per minute. Either the field is per-second on this model, or gehome's documentation is wrong universally. **Worth filing as a gehome issue.**

These don't affect our implementation (we don't expose `time_until_ready` to HomeKit — there's no clean HAP characteristic for it), but matter for anyone porting gehome's interpretation elsewhere.

## Closing notes (post-implementation)

- The brewing-cycle behavior matches the spec exactly: enable switch → status transitions `NOT_HEATING → HEATING → READY` over ~2 min → `Hot Water Ready` OccupancySensor flips occupied. Pressing the physical brew button flips `Hot Water Dispensing`.
- Round-trip latency from `Switch.set` to appliance-state-change is ~5 s — well within `updateRate`.
- WebSocket pushes for `HOT_WATER_STATUS` arrive every 2–5 s during heating, idle reads happen on demand via `onGet`. No additional polling was needed.

## On the SmartHQ Developer Portal

The user offered access to the [developer.smarthq.com](https://developer.smarthq.com/) portal. **Recommendation: not needed for this feature.**

- The portal is an OAuth-secured integrator-onboarding system for commercial partners. It documents the same Brillion REST + WebSocket API this plugin already uses.
- ERD-level documentation on the portal (if any) would not be more authoritative than the gehome community work, which has been validated against real appliances for years.
- Registering may have terms-of-service implications (commercial integrator agreement) that aren't worth incurring for a community Homebridge plugin.
- **Where the portal WOULD help**: discovering APIs we don't yet use (e.g., the Pub/Sub channels for cloud webhooks, official model→capability mapping). That's a future, separate research task, not blocking this feature.

## Citations

- **`simbaja/gehome`** Python SDK — primary ERD source. Files referenced:
  - `gehomesdk/erd/erd_codes.py` (constant definitions, line range around the fridge block)
  - `gehomesdk/erd/converters/fridge/hot_water_status_converter.py`
  - `gehomesdk/erd/values/fridge/hot_water_status.py` (the `HotWaterStatus` NamedTuple)
  - `gehomesdk/erd/values/fridge/erd_hot_water_status.py` (status enum)
  - `gehomesdk/erd/values/fridge/erd_pod_status.py`, `erd_full_not_full.py`
- **`simbaja/ha_gehome`** Home Assistant integration — primary reference implementation. Files referenced:
  - `custom_components/ge_home/devices/fridge.py` (entity wiring + detection signal)
  - `custom_components/ge_home/entities/fridge/ge_kcup_switch.py` (K-Cup enable switch)
  - `custom_components/ge_home/entities/fridge/ge_dispenser.py` (water heater entity)
- **GE Appliances Support** — confirms 192 °F brewing temperature standard: <https://products.geappliances.com/appliance/gea-support-search-content?contentId=23203>
- **SmartHQ Developer Portal** — <https://developer.smarthq.com/> · official docs at <https://docs.smarthq.com/>
