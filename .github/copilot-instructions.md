# GitHub Copilot Instructions for homebridge-smarthq

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

## Branch Management and PR Workflow

### Current Project State

- **Stable branch**: `latest` (version 0.4.0)
- **Active beta branch**: `beta-0.5.0` (currently at v0.5.0-beta.4)
- **Main development**: All new features and non-critical fixes should target `beta-0.5.0`
- **Critical patches**: For urgent fixes to stable release, may target new `beta-0.4.x` branch

### Branch Targeting Requirements

All pull requests **MUST** be directed to a beta branch first, never directly to the main branch (`latest`). This ensures proper testing and gradual release management.

### Beta Branch Creation

If no appropriate beta branch exists, create one based on the next possible version using semantic versioning:

1. **Current stable version**: Check `package.json` in the `latest` branch for the current stable version (currently 0.4.0)
2. **Current beta version**: Check if `beta-0.5.0` exists and is active (currently has v0.5.0-beta.4)
3. **Determine next version** based on change type:
   - **Patch** (bug fixes): If working on 0.4.x patches → create `beta-0.4.1`
   - **Minor** (new features): Use existing `beta-0.5.0` or create next minor version
   - **Major** (breaking changes): 1.0.0 → create `beta-1.0.0`

4. **Create beta branch** from the latest stable branch (if needed):
   ```bash
   git fetch origin
   git checkout latest
   git pull origin latest
   git checkout -b beta-X.Y.Z
   git push origin beta-X.Y.Z
   ```

**Current Status**: `beta-0.5.0` branch exists and is active with several beta releases (v0.5.0-beta.1 through v0.5.0-beta.4)

### Required Labels Before Assignment

Before assigning any issue to Copilot, the following labels **MUST** be set to determine the semantic version increment:

- **`patch`** - For bug fixes, security patches, documentation updates, and other non-feature changes
- **`minor`** - For new features, enhancements, and backwards-compatible additions
- **`major`** - For breaking changes, API changes, and backwards-incompatible modifications

### PR Workflow

1. **Check for appropriate beta branch**: Look for existing beta branches that match the intended version
2. **Create beta branch if needed**: If no appropriate beta branch exists, create one as described above
3. **Target the beta branch**: Always target PRs to the beta branch, not `latest`
4. **Use semantic versioning**: Ensure the target beta branch version aligns with the change type (patch/minor/major)

### Branch Naming Convention

- Main development branch: `latest`
- Beta branches: `beta-X.Y.Z` (e.g., `beta-0.5.0`, `beta-0.4.1`, `beta-1.0.0`)
- Feature branches: Follow standard naming (e.g., `feature/add-support-for-xyz`, `fix/bug-description`)

### Release Process

1. **Beta releases**: PRs merge to beta branches → trigger beta release workflow
2. **Stable releases**: Beta branches merge to `latest` → trigger main release workflow

### Examples

#### For a Bug Fix (patch):
- Label: `patch`
- Target branch: `beta-0.4.1` (for patches to stable 0.4.0) or `beta-0.5.0` (for patches to upcoming 0.5.0)
- If targeting patches to stable release, create `beta-0.4.1` from `latest`
- If targeting current development, use existing `beta-0.5.0`

#### For a New Feature (minor):
- Label: `minor` 
- Target branch: `beta-0.5.0` (currently active beta branch)
- Use existing `beta-0.5.0` branch which is actively receiving minor updates

#### For Breaking Changes (major):
- Label: `major`
- Target branch: `beta-1.0.0` (if current beta is 0.5.0)
- Create `beta-1.0.0` from current `beta-0.5.0` or `latest` as appropriate

### Validation

Before creating any PR, ensure:
- [ ] Appropriate label (patch/minor/major) is set on the issue
- [ ] Target beta branch exists or has been created
- [ ] Beta branch version matches the semantic version implied by the label
- [ ] All changes are focused and minimal for the specific issue being addressed

This workflow ensures proper version management, thorough testing through beta releases, and maintains stability of the main codebase.

---

## Working Effectively

### Bootstrap, Build, and Test the Repository

- Install dependencies: `npm install` -- takes 45 seconds. Wait for completion.
- Build the plugin: `npm run build` -- takes 6 seconds. NEVER CANCEL. Set timeout to 15+ seconds.
- Test the plugin: `npm run test` -- takes 2 seconds. NEVER CANCEL. Set timeout to 10+ seconds.
- Lint the code: `npm run lint` -- takes 3 seconds. NEVER CANCEL. Set timeout to 10+ seconds.
- Generate documentation: `npm run docs` -- takes 7 seconds. NEVER CANCEL. Set timeout to 15+ seconds.

### Additional Development Commands

- Check for outdated dependencies: `npm run check` -- runs install + outdated check
- Watch mode for development: `npm run watch` -- builds, copies UI files, creates symlink, starts nodemon
- Test with coverage: `npm run test-coverage` -- runs tests with coverage report
- Watch tests continuously: `npm run test:watch` -- runs tests in watch mode
- Lint documentation: `npm run docs:lint` -- validates TypeDoc generation without output
- Apply docs theme: `npm run docs:theme` -- generates docs with default-modern theme

### Pre-publication Commands (for maintainers)

- `npm run prepublishOnly` -- runs full validation: lint + build + UI + docs + docs:lint + docs:theme
- `npm run postpublish` -- cleans build artifacts after publishing

### Node.js and Environment Requirements

- Node.js version: 20+ or 22+ or 24+ (currently using v20.19.4)
- npm version: 10+ (currently using v10.8.2)
- Homebridge version: 1.9.0+ or 2.0.0+
- Platform: Linux/macOS/Windows

## Validation

### Essential Pre-Commit Validation Steps

ALWAYS run these commands before committing changes to ensure CI passes:

- `npm run lint` -- must pass with zero errors
- `npm run build` -- must complete successfully
- `npm run test` -- tests should pass (network errors in sandbox are expected)

### Manual Testing Scenarios

After making code changes to the plugin:

- Verify the plugin builds without errors: `npm run build`
- Check that TypeScript compilation produces no errors
- Ensure UI files are copied to dist/homebridge-ui/public/
- Validate that the plugin exports are correct in dist/index.js
- Test that config schema validation works for required credentials
- Verify plugin registration: check that PLUGIN_NAME and PLATFORM_NAME constants are exported
- Validate TypeScript declaration files (.d.ts) are generated properly
- Test path alias resolution works (e.g., @opal/* imports resolve correctly)

### Expected Test Behavior

- Tests run with Vitest and should complete in ~2 seconds
- Network errors (ENOTFOUND accounts.brillion.geappliances.com) are EXPECTED in sandbox environments
- Tests validate plugin registration and settings functionality
- Test files: src/index.test.ts, src/settings.test.ts

## Project Structure and Key Locations

### Source Code Organization

- `/src/` -- TypeScript source code
  - `/src/index.ts` -- main plugin entry point
  - `/src/platform.ts` -- SmartHQPlatform class (main plugin logic)
  - `/src/settings.ts` -- configuration constants and types
  - `/src/devices/` -- device-specific implementations
  - `/src/homebridge-ui/` -- custom Homebridge UI components
- `/dist/` -- compiled JavaScript output (generated by build)
- `/docs/` -- TypeDoc generated documentation
- `/node_modules/` -- npm dependencies (excluded from git)

### Key Device Types Supported

- Opal Ice Maker (primary device with scheduling and notifications)
- Air Conditioner
- Dishwasher
- Oven
- Refrigerator

### Configuration Files

- `package.json` -- project metadata, dependencies, and npm scripts
- `tsconfig.json` -- TypeScript compiler configuration
- `eslint.config.js` -- ESLint configuration using @antfu/eslint-config
- `vitest.config.ts` -- test runner configuration
- `config.schema.json` -- Homebridge plugin configuration schema
- `typedoc.json` -- documentation generation settings

### Build System Details

- TypeScript compiler (tsc) with path aliases using tsc-alias
- Path aliases: `@opal/*` maps to `src/devices/OpalIceMaker/*`
- Output target: ES2022 modules in dist/ directory
- Source maps and declaration files generated
- Custom UI files copied from src/homebridge-ui/public/ to dist/homebridge-ui/public/

## Timing Expectations and Timeouts

### Command Timing (Add 50% buffer for timeouts)

- `npm install` -- 45 seconds (timeout: 120 seconds)
- `npm run build` -- 6 seconds (timeout: 15 seconds)
- `npm run test` -- 2 seconds (timeout: 10 seconds)
- `npm run lint` -- 3 seconds (timeout: 10 seconds)
- `npm run docs` -- 7 seconds (timeout: 15 seconds)
- `npm run clean` -- instant (timeout: 5 seconds)

### CRITICAL TIMEOUT WARNINGS

- NEVER CANCEL any build or test command before the specified timeout
- Build may appear to hang during TypeScript compilation - this is normal
- Test network errors (DNS failures) are expected in sandbox environments

## Common Troubleshooting

### Build Issues

- If build fails, run `npm run clean` first to remove old artifacts
- Ensure Node.js version meets requirements (20+)
- Check that all dependencies are installed with `npm install`

### Test Issues

- Network errors during tests are expected in restricted environments
- Focus on test logic validation rather than network connectivity
- Tests should pass their core assertions despite unhandled network rejections

### Linting Issues

- Run `npm run lint:fix` to auto-fix many ESLint issues
- Common rules: curly braces, import sorting, unused variables
- Style guide enforces 1TBS brace style and consistent quote props

## Plugin-Specific Development Notes

### Homebridge Integration

- Plugin implements DynamicPlatformPlugin interface
- Registers as platform plugin with name "SmartHQ"
- Custom UI provided via homebridge-ui subdirectory
- Configuration schema supports credentials and device options

### SmartHQ API Integration

- Connects to GE Appliances SmartHQ cloud service
- Handles OAuth2 authentication flow
- Manages WebSocket connections for real-time updates
- Supports device scheduling and notification management

### Device Implementation Pattern

- Base device class in `/src/devices/device.ts`
- Device-specific classes extend base functionality
- ERD (Electronic Recipe Data) codes define device capabilities
- Platform registers accessories dynamically based on discovered devices

## CI/CD Integration

### GitHub Workflows

- Build workflow runs on push to latest branch and PRs
- Uses homebridge organization's reusable workflows
- Validates: build success, linting compliance, test execution
- Automated releases via changesets and GitHub Actions

### Quality Gates

- ESLint must pass with zero errors
- TypeScript compilation must succeed
- All tests must pass (ignoring expected network errors)
- Documentation generation must complete successfully

Always validate your changes against these criteria before pushing to ensure CI success.


### Current Project State

- **Stable branch**: `latest` (version 0.4.0)
- **Active beta branch**: `beta-0.5.0` (currently at v0.5.0-beta.4)
- **Main development**: All new features and non-critical fixes should target `beta-0.5.0`
- **Critical patches**: For urgent fixes to stable release, may target new `beta-0.4.x` branch

### Branch Targeting Requirements

All pull requests **MUST** be directed to a beta branch first, never directly to the main branch (`latest`). This ensures proper testing and gradual release management.

### Beta Branch Creation

If no appropriate beta branch exists, create one based on the next possible version using semantic versioning:

1. **Current stable version**: Check `package.json` in the `latest` branch for the current stable version (currently 0.4.0)
2. **Current beta version**: Check if `beta-0.5.0` exists and is active (currently has v0.5.0-beta.4)
3. **Determine next version** based on change type:
   - **Patch** (bug fixes): If working on 0.4.x patches → create `beta-0.4.1`
   - **Minor** (new features): Use existing `beta-0.5.0` or create next minor version
   - **Major** (breaking changes): 1.0.0 → create `beta-1.0.0`

4. **Create beta branch** from the latest stable branch (if needed):
   ```bash
   git fetch origin
   git checkout latest
   git pull origin latest
   git checkout -b beta-X.Y.Z
   git push origin beta-X.Y.Z
   ```

**Current Status**: `beta-0.5.0` branch exists and is active with several beta releases (v0.5.0-beta.1 through v0.5.0-beta.4)

### Required Labels Before Assignment

Before assigning any issue to Copilot, the following labels **MUST** be set to determine the semantic version increment:

- **`patch`** - For bug fixes, security patches, documentation updates, and other non-feature changes
- **`minor`** - For new features, enhancements, and backwards-compatible additions
- **`major`** - For breaking changes, API changes, and backwards-incompatible modifications

### PR Workflow

1. **Check for appropriate beta branch**: Look for existing beta branches that match the intended version
2. **Create beta branch if needed**: If no appropriate beta branch exists, create one as described above
3. **Target the beta branch**: Always target PRs to the beta branch, not `latest`
4. **Use semantic versioning**: Ensure the target beta branch version aligns with the change type (patch/minor/major)

### Branch Naming Convention

- Main development branch: `latest`
- Beta branches: `beta-X.Y.Z` (e.g., `beta-0.5.0`, `beta-0.4.1`, `beta-1.0.0`)
- Feature branches: Follow standard naming (e.g., `feature/add-support-for-xyz`, `fix/bug-description`)

### Release Process

1. **Beta releases**: PRs merge to beta branches → trigger beta release workflow
2. **Stable releases**: Beta branches merge to `latest` → trigger main release workflow

### Examples

#### For a Bug Fix (patch):
- Label: `patch`
- Target branch: `beta-0.4.1` (for patches to stable 0.4.0) or `beta-0.5.0` (for patches to upcoming 0.5.0)
- If targeting patches to stable release, create `beta-0.4.1` from `latest`
- If targeting current development, use existing `beta-0.5.0`

#### For a New Feature (minor):
- Label: `minor` 
- Target branch: `beta-0.5.0` (currently active beta branch)
- Use existing `beta-0.5.0` branch which is actively receiving minor updates

#### For Breaking Changes (major):
- Label: `major`
- Target branch: `beta-1.0.0` (if current beta is 0.5.0)
- Create `beta-1.0.0` from current `beta-0.5.0` or `latest` as appropriate

### Validation

Before creating any PR, ensure:
- [ ] Appropriate label (patch/minor/major) is set on the issue
- [ ] Target beta branch exists or has been created
- [ ] Beta branch version matches the semantic version implied by the label
- [ ] All changes are focused and minimal for the specific issue being addressed

This workflow ensures proper version management, thorough testing through beta releases, and maintains stability of the main codebase.

