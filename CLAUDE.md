# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run build` — `npm run clean && tsc && tsc-alias && npm run plugin-ui`. `tsc-alias` rewrites the `@root` / `@opal/*` path aliases in the emitted JS; the `plugin-ui` step rsyncs `src/homebridge-ui/public/index.html` into `dist/` (the UI server itself is TypeScript and compiled by `tsc`). Skipping either step produces a broken published package.
- `npm run lint` — ESLint over the whole repo with `--max-warnings=0`. CI fails on any warning. `npm run lint:fix` to autofix.
- `npm test` — vitest, colocated `src/*.test.ts` files. `npm run test:watch` and `npm run test-coverage` also available.
- `npm run watch` — build, `npm link`, then `nodemon`: recompiles and restarts `homebridge -U ./test/hbConfig -D` on `src/**/*.ts` changes. `./test/hbConfig` is gitignored; create it locally with a `config.json` containing SmartHQ credentials.
- `npm run docs` — typedoc into `docs/` (gitignored — generated output is never committed).
- `npm run prepublishOnly` — lint then build; runs automatically on publish.

CI (`.github/workflows/build.yml`) runs install + lint on Node 22.x/24.x. Releases publish via `.github/workflows/release.yml`: a GitHub release (tag `vX.Y.Z`) publishes to npm's `latest` tag; pushes to `beta-X.Y.Z` / `alpha-X.Y.Z` branches publish incrementing prerelease versions to the `beta` / `alpha` tags.

Supported Node: `^22.12.0 || ^24.0.0`. Homebridge: `^1.9.0 || ^2.0.0`.

## Architecture

Homebridge dynamic platform plugin (`platform: "SmartHQ"`, package `@homebridge-plugins/homebridge-smarthq`) bridging GE SmartHQ cloud appliances into HomeKit.

### Authentication (`src/getAccessToken.ts`)

Logs in to `accounts.brillion.geappliances.com` by scraping the OAuth login form with cheerio and posting credentials over an axios + cookiejar session, then exchanges the authorization code for tokens. Handles intermediate MFA-enrollment and Terms-acceptance pages automatically. Redirect URLs must be resolved with `new URL(location, LOGIN_URL)` — string concatenation produced double-slash URLs that broke login (see PR #100). Token refresh lives in `platform.ts > startRefreshTokenLogic`; on `invalid_grant` it falls back to a full username/password re-authentication.

### Device discovery and live updates (`src/platform.ts > discoverDevices`)

Fetches the appliance list from `api.brillion.geappliances.com/v1/`, then opens a websocket (`/websocket` endpoint) with a `websocket#subscribe` message and a `websocket#ping` keepalive every `KEEPALIVE_TIMEOUT` (30s). Appliance state arrives as ERD updates over this socket.

### ERDs (`src/settings.ts`)

Appliance state is addressed by ERD codes — hex identifiers like `'0x7003'` mapped in `ERD_TYPES` (name → code) and `ERD_CODES` (inverted). Device classes read/write state through `readErd` / `writeErd` helpers with these codes. When adding appliance features, find the ERD code and add it to `ERD_TYPES` rather than hard-coding hex strings.

### Device classes (`src/devices/`)

One file per appliance type (oven, dishwasher, airConditioner, hood, refrigerator, …), each extending `deviceBase` (`src/devices/device.ts`), created by the matching `createSmartHQ*` method in the `discoverDevices` switch on the appliance's type string. `deviceBase` wires platform config (per-device logging, refresh/update/push rates) onto the instance.

`src/devices/OpalIceMaker/` is the exception to the one-file pattern: a composed device split into service managers (`Managers/*SvcManager.ts` — power, nightlight, descale, filter, scheduling, progress) and status managers (`Managers/StatusManagers/`) extending `OpalStatusBase`. It has its own README.md. Imported via the `@opal/*` path alias.

### Path aliases

`@root` → `src/index.js`, `@opal/*` → `src/devices/OpalIceMaker/*` (defined in `tsconfig.json`, rewritten at build by `tsc-alias`). Use them in imports; don't add deep relative paths across those boundaries.

### Logging

The platform exposes leveled log helpers (`infoLog`, `warnLog`, `errorLog`, `debugLog`, plus `debug*` variants) gated by `config.options.logging`: `''` (default), `'standard'`, `'none'`, `'debug'`. Devices can override per-device via `deviceLogging`. Use these helpers instead of `this.log` directly so user log settings are respected.

## Conventions

- TypeScript ESM (`"type": "module"`): relative imports use `.js` extensions even from `.ts` source.
- ESLint is `@antfu/eslint-config` (flat config in `eslint.config.js`): single quotes, 1tbs braces, `curly` multi-line only, sorted exports. Run `npm run lint:fix` before committing.
- `config.schema.json` defines the Homebridge UI form and must stay in sync with the interfaces in `src/settings.ts` (`SmartHQPlatformConfig`, `devicesConfig`, `options`).
- Copyright headers in `src/` credit @donavanbecker, the original plugin author — leave them in place.
