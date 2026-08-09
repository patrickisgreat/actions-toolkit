# Versioning

What `@v1` promises, what counts as breaking, and how deprecations work.

---

## The tags

Releases are cut by release-please from Conventional Commits. Every release produces:

- an exact tag — `v1.4.0`
- a **moving major tag** — `v1`, force-repointed to that release commit

`v1` is the pin the examples use. It means: **every merge to `main` that cuts a release is
a live change for everyone on `@v1`.** That's the value (fixes propagate without a PR in
every consuming repo) and it's the obligation (a careless change breaks other people's
pipelines with no warning).

Everything below exists to make that obligation concrete.

---

## What is allowed to change within a major

### Non-breaking — ships as `feat` or `fix`

- Adding an input **with a default**, where omitting it preserves today's behaviour.
- Adding an output.
- Adding a job to a reusable workflow that is off unless opted into.
- Adding a new action or workflow.
- Bumping a wrapped third-party action within its own major.
- Fixing a bug — *unless* somebody could reasonably be relying on the bug. Then treat it
  as breaking and say so.
- Changing internal implementation while inputs and outputs stay identical.

### Breaking — needs a `BREAKING CHANGE:` footer and a new major

- Removing or renaming an input, output, or reusable workflow.
- Making an optional input required.
- Changing a default in a way that changes what the pipeline does.
- Changing what an output *means* (same name, different semantics — the worst kind,
  because nothing fails; it just goes wrong).
- Adding a step that requires a permission the caller doesn't already grant.
- Changing an action from advisory to blocking (a scan that warned now fails the build).
- Dropping a supported runtime, provider, or package manager.
- Bumping a wrapped third-party action **across a major** when its behaviour changes.

The test isn't "is this a good change?" It's: **would a repo pinned to `@v1`, that changed
nothing, behave differently after this merge?** If yes, it's breaking.

---

## Deprecation

Deletion is a last resort. Before removing anything:

1. Keep the old input working. Map it to the new one.
2. Warn on use, naming the replacement.
3. Ship the alias for at least one minor release.
4. Remove it only in the next major.

```yaml
inputs:
  vercel_token:
    description: 'DEPRECATED — use `vercel-token`. Removed in v2.'
    required: false
    default: ''
  vercel-token:
    description: Vercel access token.
    required: false
    default: ''

runs:
  using: composite
  steps:
    - shell: bash
      env:
        OLD: ${{ inputs.vercel_token }}
        NEW: ${{ inputs.vercel-token }}
      run: |
        set -euo pipefail
        if [ -n "$OLD" ]; then
          echo "::warning::Input 'vercel_token' is deprecated; use 'vercel-token'. It will be removed in v2."
        fi
        token="${NEW:-$OLD}"
        [ -n "$token" ] || { echo "::error::vercel-token is required."; exit 1; }
        echo "::add-mask::$token"
        echo "TOKEN=$token" >> "$GITHUB_ENV"
```

---

## Choosing a pin

| Pin | Trade-off |
|---|---|
| `@v1` | Fixes arrive free; a mistake here reaches you immediately. **Recommended** — the self-CI in this repo is the thing standing between you and that mistake. |
| `@v1.4.0` | Nothing changes until you change it. You also don't get security fixes until you do. Use where auditability outranks currency. |
| `@<sha>` | Immutable. Maximum supply-chain assurance, maximum upkeep. |

Whichever you pick, let Dependabot watch it:

```yaml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: weekly }
```

---

## Commit messages drive the version

release-please reads Conventional Commits. The type determines the bump:

| Commit | Bump |
|---|---|
| `fix(actions/setup-node): ...` | patch → `1.4.1` |
| `feat(workflows/node-ci): ...` | minor → `1.5.0` |
| `feat(actions/llm-call)!: ...` with `BREAKING CHANGE:` in the body | major → `2.0.0` |
| `docs:`, `chore:`, `ci:`, `test:` | none |

Scope names the unit: `actions/setup-node`, `workflows/node-ci`, `docs`, `ci`, `deps`.

```
feat(actions/llm-call)!: rename `api_key` to `api-key`

Every input in the toolkit is kebab-case; this was the last holdout.

BREAKING CHANGE: callers passing `api_key` must rename it to `api-key`.
```

---

## When v2 happens

A new major is a real cost for everyone consuming the toolkit, so it should batch:

1. Breaking changes accumulate on a `v2` branch rather than trickling out.
2. `v1` keeps getting fixes for a stated window after `v2.0.0`.
3. `MIGRATION.md` gets a v1→v2 section with a mechanical before/after for every break.
4. `v1` and `v2` both exist as moving tags; `@v1` never silently becomes v2.

The unforgivable failure mode is repointing `v1` at something that breaks `v1` consumers.
If you're unsure whether a change is breaking, it's breaking.
