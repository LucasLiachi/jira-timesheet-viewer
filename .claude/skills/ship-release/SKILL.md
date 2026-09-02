---
name: ship-release
description: Delivers a finished change to "Jira Timesheet Viewer" on GitHub — bumps the version in manifest.json, adds an entry to the version-history page published on GitHub Pages (docs/changelog.html), commits, and (after explicit confirmation) pushes to main and pushes a vX.Y.Z tag so the release.yml GitHub Action builds the extension zip and publishes it as a downloadable GitHub Release. Use this skill ALWAYS after a code change to the extension is implemented and verified (typically via the jira-timesheet-viewer skill) and the user asks to publish it, ship it, release it, or otherwise says the work is ready to go out — phrases like "publica", "sobe pro github", "faz o release", "cria uma release", "atualiza a versão", "libera essa versão", "manda pro GitHub". Do not use this skill to implement features or fix bugs — that's jira-timesheet-viewer's job; this skill only runs after that work is done and committed.
---

# Ship Release

Closes the loop the user asked for on 2026-09-02: they describe what they want, the `jira-timesheet-viewer` skill builds it, and this skill delivers it — updates the version-history page and publishes a downloadable GitHub Release, without the user touching git or GitHub by hand.

This skill never writes application code. If the requested change isn't implemented yet, stop and hand off to `jira-timesheet-viewer` first.

---

## The flow

```
1. User describes what they want
2. jira-timesheet-viewer skill implements + verifies it (unpacked-load check by the user)
3. ship-release skill (this one): version bump → changelog entry → commit →
   confirm with user → push to main + tag → release.yml builds the zip and
   publishes the GitHub Release
```

Steps 1–2 are a separate skill's job. From here on, assume the change is already committed (or about to be, alongside the version bump — see below) and the user has said it's ready to go out.

---

## Non-negotiables

**Never push to `main` or push a tag without the user confirming first.** Both are public, hard to reverse (a tag push immediately fires the release workflow and publishes a real, downloadable artifact) — this is exactly the class of action that needs a stop-and-confirm, per the project's general safety rules, even though the user has pre-authorized the *shape* of this flow by asking for the skill.

**Never invent what changed.** The changelog entry and the version bump both come from `git log`/`git diff` against the last tag, not from guessing. If it's unclear whether a change is patch/minor/major, ask.

**English in the artifact, Portuguese in the conversation.** `docs/changelog.html` entries, commit messages and the tag itself are English — same rule as the rest of the project (see `CLAUDE.md` → Comunicação).

---

## Steps

### 1. Confirm there's something to ship

```bash
git status
git log --oneline -5
git tag --sort=-creatordate | head -1   # last released version, if any
```

If there are uncommitted changes belonging to the feature/fix itself, those get committed normally first (outside this skill's concern) — don't fold unrelated code changes into the version-bump commit.

### 2. Decide the version bump

Read `manifest.json`'s current `version`. Look at what changed since the last tag:

```bash
git log <last-tag>..HEAD --oneline
```

Classify semver-style — patch (fix/small tweak), minor (new capability, backward compatible), major (breaking change to how the extension is used/configured). **Ask the user to confirm the bump** unless it's obviously a patch (typo, small bugfix) — this is a judgment call the user should make, not something to silently decide.

### 3. Update `manifest.json`

Bump the `"version"` field only. Nothing else in the manifest changes as part of this skill.

### 4. Add a changelog entry to `docs/changelog.html`

Insert a new `<div class="release">` block right after the `<!-- ship-release skill: newest entry goes right below this comment -->` marker (newest first), following the existing block's structure:

```html
<div class="release">
  <h2>vX.Y.Z</h2>
  <p class="date">{Month DD, YYYY}</p>
  <ul>
    <li>{one bullet per user-visible change, plain English, no jargon}</li>
  </ul>
  <a class="download" href="https://github.com/LucasLiachi/jira-timesheet-viewer/releases/tag/vX.Y.Z">Download this version →</a>
</div>
```

Bullets summarize what a *user* of the extension would notice — not internal refactors, not "fixed a bug in panel.js." Pull the substance from `git log <last-tag>..HEAD`, don't reword the commit subjects verbatim if they're implementation-focused.

### 5. Commit

```bash
git add manifest.json docs/changelog.html
git commit -m "Release vX.Y.Z"
```

Keep this commit scoped to just these two files — if feature code isn't committed yet, that's a separate commit before this one.

### 6. Stop and confirm before publishing

Show the user: the new version number, the changelog bullets, and state plainly that the next step pushes to `main` and pushes a tag that **immediately triggers a public GitHub Release** with a downloadable zip. Wait for explicit go-ahead — do not push on your own inference that "ready to ship" already covered this specific push.

### 7. Push and tag

```bash
git push origin main
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```

### 8. Verify the Action ran

```bash
gh run list --workflow=release.yml --limit=1
gh release view vX.Y.Z
```

Report back: the release URL, and whether the zip asset attached correctly. If the workflow failed, read its log (`gh run view --log`) before trying anything — don't re-push the same tag (tag pushes aren't idempotent-safe; deleting and re-pushing a tag is itself a destructive action that needs its own confirmation).

---

## How `release.yml` works

`.github/workflows/release.yml` triggers on any tag push matching `v*.*.*`. It checks out the repo, runs `scripts/package_extension.py` (the same script used for the Chrome Web Store upload — see the project skill's layout) to produce `dist/jira-timesheet-viewer-vX.Y.Z.zip`, then publishes a GitHub Release for that tag with the zip attached and auto-generated release notes from the commit range. Nothing about this workflow is specific to Chrome Web Store publishing — it's a separate, independent distribution channel for anyone who wants to sideload the extension without the Store.

`docs/changelog.html` is **not** generated by the workflow — it's maintained by this skill, by hand, ahead of the push, because it needs human-readable bullets, not raw commit logs. GitHub Pages serves it straight from `docs/` on `main` (same mechanism already serving `docs/index.html`, the privacy policy) — no separate Pages-deploy workflow needed.

---

## Verification

```bash
# manifest version actually changed and is valid JSON
python -c "import json;print(json.load(open('manifest.json'))['version'])"

# changelog entry was added, not just planned
grep -c "class=\"release\"" docs/changelog.html

# tag matches manifest version exactly
git describe --tags --abbrev=0
```
