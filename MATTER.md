# Matter Support for homebridge-smarthq

This document describes the Matter implementation for the homebridge-smarthq plugin.

## Architecture Overview

The plugin now supports **both HAP (HomeKit Accessory Protocol) and Matter** protocols. Each device intelligently chooses which protocol to use based on:

1. Homebridge Matter availability (requires Homebridge 2.0.0-beta.63+)
2. Matter enabled status in Homebridge settings
3. Per-device configuration (`useMatter` option)

## Key Components

### 1. Platform Changes ([src/platform.ts](src/platform.ts))

**New Properties:**

- `matterEnabled`: Tracks if Matter is enabled in Homebridge settings
- `matterAvailable`: Tracks if Homebridge supports Matter API

**New Methods:**

- `checkMatterSupport()`: Detects Matter availability and enabled status at startup
- `shouldUseMatter(device)`: Determines if a device should use Matter or HAP
- `createSmartHQRefrigeratorMatter()`: Creates Matter version of refrigerator accessory
- `createSmartHQRefrigeratorHAP()`: Creates HAP version of refrigerator accessory (existing behavior)

**Startup Flow:**

```
Constructor
├─ checkMatterSupport() // Check Matter availability
├─ discoverDevices()
└─ For each device:
    ├─ shouldUseMatter(device) // Decide protocol
    ├─ Create Matter accessory OR
    └─ Create HAP accessory
```

### 2. Matter Base Class ([src/devices/deviceMatter.ts](src/devices/deviceMatter.ts))

Base class for all Matter-enabled devices providing:

**Core Features:**

- ERD (Electronic Refrigerator Descriptor) reading/writing
- Matter cluster state updates
- Device logging and configuration
- Firmware version management
- Unsupported ERD caching (prevents API spam)

**Abstract Methods:**

- `createMatterAccessory()`: Must be implemented by each device type

**Helper Methods:**

- `createBaseMatterConfig()`: Generates common Matter accessory info
- `updateMatterState()`: Updates Matter cluster attributes
- `readErd()` / `writeErd()`: SmartHQ API communication

### 3. Matter Refrigerator Implementation ([src/devices/refrigeratorMatter.ts](src/devices/refrigeratorMatter.ts))

**Example implementation showing:**

- Matter Thermostat device type for temperature control
- Setpoint raise/lower handler
- Periodic ERD refresh
- Temperature/setpoint updates via Matter clusters
- Door status and ice bucket status parsing (ready for multi-endpoint support)

**Matter Device Type:** `Thermostat`

- `localTemperature`: Current fridge temperature (0.01°C units)
- `occupiedCoolingSetpoint`: Target temperature (0.01°C units)
- `systemMode`: Always 3 (COOL)
- `thermostatRunningMode`: 3 (cooling)

**Clusters Used:**

- `Thermostat`: Temperature control
- `TemperatureMeasurement`: Current temperature reading

### 4. Device Configuration ([src/settings.ts](src/settings.ts))

**New Config Option:**

```typescript
/**
 * Device-level Matter override.
 * If set, this device will use Matter (true) or HAP (false) regardless of global setting.
 */
export interface SmartHQDeviceConfig {
  // ...other options...
  useMatter?: boolean
}
```

## Usage

### Configuration

**Enable Matter globally (all devices use Matter when available):**

```json
{
  "platform": "SmartHQ",
  "name": "SmartHQ",
  "credentials": {
    "username": "your-email@example.com",
    "password": "your-password"
  }
}
```

**Disable Matter for specific device:**

```json
{
  "platform": "SmartHQ",
  "name": "SmartHQ",
  "devices": [
    {
      "useMatter": false // This device will use HAP instead
    }
  ]
}
```

### Requirements

- Homebridge 2.0.0-beta.63 or later
- Matter enabled in Homebridge settings:
  - Main bridge: Enable Matter in Homebridge UI settings
  - Child bridge: Enable Matter in plugin bridge settings

## Device Support Matrix

| Device Type     | HAP Support | Matter Support | Matter Device Type | Notes                                                             |
| --------------- | ----------- | -------------- | ------------------ | ----------------------------------------------------------------- |
| Refrigerator    | ✅ Full     | ✅ Partial     | Thermostat         | Temperature control implemented, doors/ice pending multi-endpoint |
| Clothes Washer  | ✅ Full     | ⏳ Planned     | Custom/Outlet      | Needs implementation                                              |
| Clothes Dryer   | ✅ Full     | ⏳ Planned     | Custom/Outlet      | Needs implementation                                              |
| Dishwasher      | ✅ Full     | ⏳ Planned     | Custom/Outlet      | Needs implementation                                              |
| Oven            | ✅ Full     | ⏳ Planned     | Thermostat         | Needs implementation                                              |
| Ice Maker       | ✅ Full     | ⏳ Planned     | Custom             | Needs implementation                                              |
| Air Conditioner | ✅ Full     | ⏳ Planned     | Thermostat/Fan     | Needs implementation                                              |
| Hood            | ✅ Full     | ⏳ Planned     | Fan                | Needs implementation                                              |
| Water Filter    | ✅ Full     | ⏳ Planned     | FilterMaintenance  | Needs implementation                                              |
| Water Softener  | ✅ Full     | ⏳ Planned     | FilterMaintenance  | Needs implementation                                              |
| Water Heater    | ✅ Full     | ⏳ Planned     | Thermostat         | Needs implementation                                              |

## Implementation Status

### ✅ Completed

1. Matter availability detection
2. HAP/Matter decision logic
3. Matter base class with ERD support
4. Refrigerator Matter implementation (temperature control)
5. Type declarations for Matter API

### ⏳ In Progress

- Multi-endpoint support for refrigerator doors and ice buckets
- Matter implementations for remaining device types

### 📋 To Do

1. Complete refrigerator multi-endpoint support
2. Implement Matter versions of:
   - Clothes Washer
   - Clothes Dryer
   - Dishwasher
   - Oven
   - Ice Maker
   - Air Conditioner
   - Hood
   - Water Filter/Softener/Heater
3. Add Matter accessory caching and restoration
4. Add comprehensive error handling
5. Testing across Matter controllers (Apple Home, Google Home, Amazon Alexa)

## Implementation Notes

### Type Errors

The current implementation has TypeScript errors because the Matter API types are not yet available in the `homebridge` package types. A type declaration file (`matter.d.ts`) has been created to provide these types, but TypeScript module augmentation requires additional configuration.

**Resolution Options:**

1. Wait for official Homebridge 2.0 types with Matter support
2. Install `@types/homebridge` beta version when available
3. Add custom type declarations to `tsconfig.json` paths

### ERD Caching

Both HAP and Matter implementations share the ERD caching system that remembers unsupported ERDs to prevent API spam (400 errors).

### Fallback Behavior

If Matter registration fails, the plugin automatically falls back to HAP:

```typescript
try {
  await this.createMatterAccessory()
} catch (error) {
  this.log.warn('Matter failed, falling back to HAP')
  await this.createHAPAccessory()
}
```

## Development Guidelines

### Adding Matter Support to New Device

1. Create `deviceNameMatter.ts` extending `deviceBaseMatter`
2. Implement `createMatterAccessory()` method
3. Choose appropriate Matter device type
4. Map ERDs to Matter clusters
5. Implement cluster handlers
6. Add periodic refresh logic
7. Update platform.ts with device creation methods:
   - `createSmartHQDeviceName()`
   - `createSmartHQDeviceNameHAP()`
   - `createSmartHQDeviceNameMatter()`

### Matter Device Type Selection

| SmartHQ Device  | Recommended Matter Type | Clusters                           |
| --------------- | ----------------------- | ---------------------------------- |
| Refrigerator    | Thermostat              | Thermostat, TemperatureMeasurement |
| Oven            | Thermostat              | Thermostat, TemperatureMeasurement |
| Washer/Dryer    | OnOffOutlet + Custom    | OnOff, OperationalState            |
| Dishwasher      | OnOffOutlet + Custom    | OnOff, OperationalState            |
| Air Conditioner | Thermostat + Fan        | Thermostat, FanControl             |
| Hood            | Fan                     | FanControl, OnOff                  |
| Water Heater    | Thermostat              | Thermostat                         |

## Testing

### Verify Matter Support

Check Homebridge logs for:

```
[SmartHQ] Matter support: ENABLED - Devices will register as Matter accessories
[SmartHQ] [Matter] Creating refrigerator: My Fridge
[SmartHQ] [Matter] ✓ Registered refrigerator: My Fridge
```

### Test Temperature Control

1. Open Matter-compatible app (Apple Home, Google Home, etc.)
2. Find refrigerator accessory
3. Adjust target temperature
4. Verify ERD write in Homebridge logs
5. Verify temperature updates reflect in app

## Troubleshooting

### "Matter is not available"

- Upgrade to Homebridge 2.0.0-beta.63 or later
- Check Homebridge UI for Matter settings

### "Matter is available but not enabled"

- Enable Matter in Homebridge settings page
- For child bridges, enable in plugin bridge settings

### Device registers as HAP instead of Matter

- Check `useMatter` device config (if specified)
- Verify Matter is enabled in Homebridge
- Check logs for fallback messages

### TypeScript compilation errors

- Current implementation has type errors due to missing Matter types
- Plugin will work at runtime when Homebridge 2.0 is installed
- Types will be resolved when official Homebridge 2.0 types are released

## References

- [Homebridge Matter Plugin Example](https://github.com/homebridge-plugins/homebridge-matter)
- [homebridge-switchbot beta-5.0.0 Matter Implementation](https://github.com/OpenWonderLabs/homebridge-switchbot/blob/beta-5.0.0/src/platform-matter.ts)
- [Matter Specification](https://csa-iot.org/all-solutions/matter/)
- [Homebridge API Documentation](https://developers.homebridge.io/)

## Contributing

Contributions are welcome! To add Matter support for a new device:

1. Create feature branch from `beta-0.5.0`
2. Implement Matter device class
3. Add device creation methods to platform
4. Test with real hardware if possible
5. Submit PR to `beta-0.5.0` branch

## License

ISC License - Copyright (C) 2021-2024, donavanbecker
