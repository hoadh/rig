# Release Rig

Ship a new version of the Rig plugin: a beta (`2.1.0-beta.1`), a stable release (`2.1.0`) or a fix (`2.0.1`). This guide is for maintainers with push access to `hoadh/rig`.

A release is a git tag plus a marketplace entry pinned to that tag. There is no zip and no npm package. Users get a release when the marketplace on `main` points at it and they run `claude plugin update`.

## Rules that apply between releases

- **Every change to `plugins/rig/**` raises the plugin version.** CI (`plugin version bump`) fails a pull request that changes the plugin without a greater `version` in `plugins/rig/.claude-plugin/plugin.json`. The first plugin change after a release opens the next version (for example `2.0.0-beta.1` to `2.0.0-beta.2`, or `2.0.0` to `2.0.1`). Later changes for the same release keep it.
- **`plugin.json` is the only version.** The marketplace entry in `.claude-plugin/marketplace.json` has no `version`; Claude Code reads it from `plugin.json` at the pinned commit. Do not add one: the CI gate requires it to equal `plugin.json`, which cannot hold between releases while the pin still names the previous one.
- **Keep `package.json` `version` equal to `plugin.json`.** Nothing checks it.
- **Record the change in `CHANGELOG.md`** under `## <next version> (unreleased)`, Breaking items first.
- **Merge to `main` without rewriting commits** (fast-forward or merge commit, not squash or rebase). A release tag must stay reachable from `main`, and the CI check `marketplace ref matches latest tag` fails when it is not.

## Choose the version

| Release | Version | Branch | Who installs it |
|---|---|---|---|
| Beta of a new major or minor | `X.Y.0-beta.N` | a release branch, or `main` | Testers, from the branch (see [Install a beta](./install-and-update-rig.md#install-a-beta)) |
| Stable | `X.Y.Z` | `main` | Everyone, through `/plugin marketplace add hoadh/rig` |
| 1.x fix | `1.1.Z` | `release/1.x` | 1.x users. Uses the 1.x process on that branch, not this guide |

The version must be strict semver and greater than the latest `v*` tag. A prerelease sorts below its stable version (`2.1.0-beta.3` < `2.1.0`).

## Steps

### 1. Prepare the release commit

On the branch you release from, in one pull request:

1. Set the version in `plugins/rig/.claude-plugin/plugin.json` and `package.json`.
2. In `CHANGELOG.md`, change `## <version> (unreleased)` to `## <version> (<YYYY-MM-DD>)`.
3. Update the version lines in `docs/project/roadmap.md`, `docs/reference/codebase-summary.md`, `docs/explanation/architecture.md` and `docs/project/overview-pdr.md`.
4. Wait for CI to pass on Ubuntu, Windows and macOS, plus `plugin-validate` on the Claude Code floor and the latest version.

### 2. Run the live checks

CI does not run a real Claude Code install. Before a stable release, and before a beta that changes the areas below, check on real machines. Use a disposable `HOME` (Windows: `USERPROFILE`), never your own `~/.claude`.

| Changed area | Check |
|---|---|
| Always | `npm test` on Linux and Windows; the plugin loads with `claude --plugin-dir ./plugins/rig` |
| `rig-init` | Install Rig 1.x from `release/1.x`, then `rig-init --plan`, `--migrate`, `--runtime`, `--permissions`, and restore with the backup's `restore.cjs`. On Windows, also migrate with `statusline.cjs` held open (expect exit 3, then `--resume`) |
| `bin/` | Each entrypoint by bare name in Git Bash, and through `node <bin>` in PowerShell and cmd |
| `rig:remote` | `rig-remote doctor` and `rig-remote run` from Linux to a Windows worker with the new runtime |

Steps that answer a `y/N` prompt run in your terminal. Claude Code can prepare the disposable environment and read the results, but it cannot answer for you.

### 3. Dry run

```bash
node scripts/release-plugin.cjs                  # on main
node scripts/release-plugin.cjs --allow-branch   # a beta from another branch
```

It checks a clean tree, the branch, the version against the latest tag, and runs `npm test`. It prints the content commit, the pinned marketplace entry and the tag. Nothing is written.

### 4. Tag

In a terminal outside Claude Code (the script refuses to run inside it):

```bash
node scripts/release-plugin.cjs --apply [--allow-branch]
```

Answer `y`. The script:

1. tags the current commit (the content commit) as `v<version>`, annotated, or signed when git signing is set up;
2. on `main`, creates the branch `release/v<version>` and switches to it; on another branch (a beta), stays there;
3. commits `.claude-plugin/marketplace.json` with `ref: v<version>` and `sha: <content commit>` on that branch.

The pin is one commit after the tag, because the entry has to name the commit that contains the content. So a marketplace read at the tag has the unpinned entry. Install from the branch, never from `#v<version>`.

### 5. Push

The script never pushes; it prints the commands below with the version filled in.

**From `main`.** `main` has the ruleset `main-ci-required`: required checks (lint, node tests on 3 OSes, plugin version bump, validate), no force push, no deletion, and no bypass. The pin commit is new, so it reaches `main` through a pull request like any other change:

```bash
git push -u origin release/v<version>
gh pr create --base main --head release/v<version> --title "release: pin marketplace to v<version>" --body "Release pin for v<version>."
# after CI on the pull request passes:
git checkout main && git merge --ff-only release/v<version> && git push origin main v<version>
git push origin --delete release/v<version> && git branch -d release/v<version>
```

Push the tag only with the merge, so `main` never has a tag newer than its pin.

**From another branch (a beta).** Push the branch and the tag together:

```bash
git push origin <branch> v<version>
```

Testers can install now with the command the script printed (`/plugin marketplace add hoadh/rig#<branch>`). For a beta that should reach everyone, merge the branch into `main` by pull request (fast-forward).

### 6. Verify

1. CI on `main` passes, including `marketplace ref matches latest tag`.
2. In a disposable `HOME` on Linux, Windows and macOS:

   ```text
   claude plugin marketplace add hoadh/rig
   claude plugin install rig@rig-marketplace
   claude plugin list
   ```

   Expect the new version, enabled. `claude plugin validate <cache dir>` passes, and `node <cache dir>/bin/rig-init --plan` runs.
3. On a machine that has the previous release, follow [Update](./install-and-update-rig.md#update) and check that `claude plugin list` shows the new version.

### 7. Publish the GitHub Release

Every tag gets a GitHub Release, so the Releases page and its "Latest" badge match the marketplace. The notes are the version's CHANGELOG section without its heading:

```bash
v=<version>
awk -v v="$v" '/^## /{p=($2==v)} p && !/^## /' CHANGELOG.md | sed -e '/./,$!d' > /tmp/rig-release-notes.md
gh release create "v$v" --title "Rig $v" --notes-file /tmp/rig-release-notes.md --latest   # stable
gh release create "v$v" --title "Rig $v" --notes-file /tmp/rig-release-notes.md --prerelease # beta
```

Check with `gh release list`: a stable release shows as `Latest`, a beta as `Pre-release`. If a release was skipped, create it later the same way; pass `--latest=false` for any version older than the current latest.

### 8. Open the next version

The first plugin change after the release raises the version and adds `## <next version> (unreleased)` to `CHANGELOG.md` (see the rules above).

## When a release is broken

Do not move or delete a pushed tag: installs pin its commit. Fix forward. Raise the version (`beta.N+1` or the next patch), fix, and release again. The script refuses a version that is not greater than the latest tag, so a pin cannot go backwards by accident.

## Related

- [Install and update Rig](./install-and-update-rig.md)
- [Architecture](../explanation/architecture.md), section on CI and releases
- `scripts/release-plugin.cjs`: header comment and `--check-ref`
