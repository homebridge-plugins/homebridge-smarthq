# GitHub Copilot Instructions for homebridge-smarthq

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