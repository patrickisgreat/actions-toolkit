# CLAUDE.md

Operating guidance for Claude Code (and humans) working in **actions-toolkit**. Read this
before making changes. Authoring rules live in [docs/AUTHORING.md](docs/AUTHORING.md); the
consumer-facing contract is [docs/CONSUMING.md](docs/CONSUMING.md).

## What this repo is

A library of **reusable GitHub Actions building blocks** that other repos consume by
reference. Two layers:

- **`actions/<name>/action.yml`** — composite actions. Fine-grained, single-purpose,
  no opinion about triggers. Use these when you're writing your own workflow.
- **`.github/workflows/<name>.yml`** — reusable workflows (`on: workflow_call`). Opinionated
  end-to-end pipelines assembled from the composite actions. Use these when you want a
  whole pipeline in five lines.

Consumers pin by tag: `uses: patrickisgreat/actions-toolkit/actions/setup-node@v1`.

## The one structural rule you must know

**A reusable workflow cannot use `./actions/...`.** Inside a workflow called from another
repo, `./` resolves to the *caller's* checkout, not this repo. Every reusable workflow
therefore starts each job with:

```yaml
- name: Check out the toolkit
  uses: actions/checkout@v7
  with:
    repository: patrickisgreat/actions-toolkit
    ref: ${{ github.job_workflow_sha || github.sha }}
    path: .toolkit
- uses: ./.toolkit/actions/setup-node
```

`github.job_workflow_sha` is the commit SHA of *the reusable workflow file being executed*.
Using it means the composite actions a workflow runs are always the exact ones from the
same commit as the workflow — a caller pinned to `@v1.4.0` gets v1.4.0 actions, and this
repo's own CI tests HEAD against HEAD. Never hardcode a tag there.

This is encoded once in the boilerplate at the top of every reusable workflow. Copy it
verbatim when adding a new one; `scripts/validate-manifests.mjs` fails the build if a
reusable workflow references a local action any other way.

## Toolchain & common commands

```bash
brew install actionlint yamllint shellcheck
npm install
```

| Command | What it does |
|---------|--------------|
| `make lint` | actionlint (+ shellcheck on every `run:`) and yamllint |
| `make validate` | Structural checks on action/workflow contracts |
| `make docs` | Regenerate per-action READMEs and the root catalog |
| `make docs-check` | Fail if generated docs are stale (what CI runs) |
| `make new-action NAME=deploy-foo` | Scaffold from `templates/action.yml.tmpl` |
| `make all` | Everything CI runs |

**Always run `make all` before committing.**

## Git workflow

Same house style as `tf-tools`. Treat it as a hard rule.

- `main` is always releasable. **Never commit feature work directly to `main`** — branch
  and open a PR.
- Branch names: `type/short-kebab-description` (`feat/deploy-fly-action`,
  `fix/node-ci-dependabot-lockfile`).
- **Conventional Commits**, linted on every PR. Scope names the unit you touched:
  `actions/setup-node`, `workflows/node-ci`, `docs`, `ci`, `deps`.

```
feat(actions/llm-call): add OpenRouter provider
fix(workflows/node-ci): don't fail format gate on lockfile churn
docs(consuming): document the job_workflow_sha pin
```

- **One concern per PR**, small diffs. A new action plus its docs and a self-test is one
  coherent PR.
- CI must be green: actionlint, yamllint, manifest validation, docs drift, commitlint,
  and the self-tests that actually execute each action.

## Versioning contract

Consumers pin to a **moving major tag** (`@v1`) or an exact release (`@v1.4.0`).
`self-release.yml` cuts releases with release-please and force-moves `v1` to each new
release commit. That makes every merge to `main` a potential breaking change for everyone
on `@v1`, so:

- **Adding an input with a default is a `feat`.** Non-breaking.
- **Removing or renaming an input, changing a default in a way that changes behavior, or
  changing an output's meaning is `BREAKING CHANGE:`** and needs a `v2`.
- Deprecate before you delete: keep the old input, warn via `::warning::`, and map it to
  the new one for at least one minor.

Full policy in [docs/VERSIONING.md](docs/VERSIONING.md).

## Authoring rules (summary)

Full detail in [docs/AUTHORING.md](docs/AUTHORING.md). The essentials:

- **Never interpolate `${{ }}` into a `run:` body.** Bind it to `env:` and reference the
  env var. Untrusted input (issue titles, PR bodies, branch names) becomes shell injection
  otherwise. `make validate` enforces this.
- Every `run:` block opens with `set -euo pipefail`.
- Every input has a `description`; every optional input has an explicit `default: ''`.
- Composite actions **cannot read `secrets`** — take credentials as inputs and let the
  caller pass them.
- **A composite action never `uses:` another action from this repo.** Local-path resolution
  inside a composite action differs depending on how the action was reached, so an action
  that references a sibling works in this repo's tests and breaks for consumers. Composition
  happens one layer up, in the reusable workflow, where the `.toolkit` checkout makes the
  path unambiguous. Actions stay leaves; they emit outputs and the workflow wires them.
- Prefer failing fast with a `::error::` that names the missing secret or variable over a
  confusing downstream 401.
- Pin third-party actions to at least a major tag; Dependabot keeps them current.
- Default to the cheap and safe choice: read-only permissions, smallest runner, skip on
  drafts and forks where secrets aren't available.

## Gotchas

- `secrets: inherit` passes *all* caller secrets to a called workflow. Reusable workflows
  here declare their secrets explicitly so consumers can choose; `inherit` still works.
- Fork PRs run without repo secrets under `pull_request`. Any workflow needing a secret
  guards with `github.event.pull_request.head.repo.full_name == github.repository`.
- Dependabot-triggered runs use the *Dependabot* secret store, not Actions secrets — an
  AI-review or deploy job will see empty strings. Skip `github.actor == 'dependabot[bot]'`.
- `github.job_workflow_sha` is populated when a workflow is called from *another* repo, but
  observed empty when a workflow in this repo is called locally (`uses: ./.github/...`),
  which is how self-CI exercises them. Hence `|| github.sha`: locally that is the commit
  under test, which is exactly right. An earlier `|| 'main'` fallback silently checked out
  the wrong tree and produced "Can't find action.yml under .toolkit/…".
- OIDC (`id-token: write`) is the default cloud auth path here. Long-lived keys are
  supported but every action that accepts them emits a `::warning::`.
