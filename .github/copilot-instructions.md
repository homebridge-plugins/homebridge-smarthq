# Copilot instructions

Guidance for AI coding agents working in this repository. The fuller version of this document is [CLAUDE.md](../CLAUDE.md) at the repo root — keep the two in sync.

## Commands

- Build: `npm run build` (clean → `tsc` → `tsc-alias` → copy plugin UI html). All steps are required for a working package.
- Lint: `npm run lint` (`eslint . --max-warnings=0`, CI fails on warnings); `npm run lint:fix` to autofix.
- Test: `npm test` (vitest, colocated `src/*.test.ts`).
- Local dev loop: `npm run watch` (rebuild + restart `homebridge -U ./test/hbConfig -D` on changes; `./test/hbConfig` is gitignored, create locally).

## Key architecture facts

- Homebridge dynamic platform plugin bridging GE SmartHQ cloud appliances into HomeKit.
- Auth (`src/getAccessToken.ts`): scrapes the SmartHQ OAuth login form (cheerio + axios cookiejar), handles MFA/terms pages; always resolve redirect URLs with `new URL(location, LOGIN_URL)`, never string concatenation.
- Live state arrives over a websocket subscription with a 30s ping keepalive (`src/platform.ts > discoverDevices`).
- Appliance state is addressed by ERD hex codes mapped in `ERD_TYPES` (`src/settings.ts`); use `readErd`/`writeErd` with named entries, never hard-coded hex.
- One device class per appliance type in `src/devices/`, extending `deviceBase` in `src/devices/device.ts`. `src/devices/OpalIceMaker/` is a composed device using a manager pattern (see its README).
- Path aliases: `@root` → `src/index.js`, `@opal/*` → `src/devices/OpalIceMaker/*` (rewritten at build by `tsc-alias`).
- Use the platform's leveled log helpers (`infoLog`, `debugLog`, …) so user logging settings are respected.

## Conventions

- TypeScript ESM: relative imports need `.js` extensions.
- ESLint `@antfu/eslint-config`: single quotes, sorted exports; run `npm run lint:fix` before committing.
- `config.schema.json` must stay in sync with the config interfaces in `src/settings.ts`.
- Copyright headers in `src/` credit @donavanbecker (original author) — leave them in place.
