# Migration

Moving an existing repo onto the toolkit, without a big-bang cutover.

---

## The approach

Do not convert everything at once. A CI pipeline is load-bearing, and a rewrite that fails
for an unrelated reason is hard to diagnose and tempting to revert wholesale.

Run both in parallel for a few PRs instead:

1. Add the toolkit workflow under a new name (`ci-next.yml`) with no branch protection on
   it, alongside the existing one.
2. Open a throwaway PR. Compare the two runs — same failures, comparable duration.
3. Move any required-status-check rules onto the new job names.
4. Delete the old workflow.

Step 2 is the one people skip and regret. The toolkit's defaults are not always your
current defaults, and the differences are much cheaper to find on a scratch PR.

---

## threaditate → node-ci

The existing `ci.yml` is 298 lines: five jobs, each repeating checkout → pnpm → node →
install. The replacement:

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:
  schedule:
    - cron: '0 9 * * *'

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}

jobs:
  ci:
    uses: patrickisgreat/actions-toolkit/.github/workflows/node-ci.yml@v1
    with:
      node-version: '22'
      pnpm-version: '10.11.0'
      e2e: auto
      build-env: |
        NEXT_PUBLIC_SUPABASE_URL=NEXT_PUBLIC_SUPABASE_URL
        NEXT_PUBLIC_SUPABASE_ANON_KEY=NEXT_PUBLIC_SUPABASE_ANON_KEY
        NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
      public-env: |
        NEXT_PUBLIC_DISABLE_POSTHOG=true
    secrets: inherit
```

What carries over automatically, because it was built into the workflow from this repo:

| Behaviour | Where it went |
|---|---|
| Dependabot lockfile handling (`--no-frozen-lockfile`) | `setup-node`, `frozen-lockfile: auto` |
| Format-then-diff gate excluding `pnpm-lock.yaml` | `format-command` + `format-ignore` default |
| Smoke e2e on PRs, full on main and cron | `e2e: auto` |
| Coverage → Codecov | `coverage: true` (default) |
| Concurrency cancel, main exempt | Stays in your caller file — it's trigger-level |

What needs a decision:

- **Lighthouse** has no equivalent workflow. Keep it as a separate job in the caller; it
  runs its own build and is non-blocking, so it doesn't need to be in the shared pipeline.
- **Job names change**, which breaks required status checks. Update branch protection to
  the new names (`ci / Lint & format`, `ci / Unit tests`, …), or point it at a single
  aggregate job you define in the caller.

`release.yml` maps onto `release-please.yml` with `auto-merge: true` — the personal-repo
check-polling workaround is already inside it, including the two subtleties about
`fromJSON('')` and "no required checks". `claude-code-review.yml` maps onto `ai-pr-review`
with `use-code-review-plugin: true`.

---

## tf-tools → terraform-ci

The current `ci.yml` validates every module in one serial job. The replacement fans out:

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:

jobs:
  ci:
    uses: patrickisgreat/actions-toolkit/.github/workflows/terraform-ci.yml@v1
    with:
      directories: 'modules environments'
      version: auto          # reads .terraform-version — 1.15.6 stays authoritative
      docs-check: true
      trivy-fail: false      # matches today's exit-code: "0"
```

The `.validate-skip` convention is preserved exactly — modules wrapping live third-party
APIs still opt out with the marker file, and the discovery job logs a `::notice::` for each
one it skips.

`commitlint.yml` needs no change; it's already three lines of a maintained action.

Two things you gain that the current pipeline doesn't have:

- Validation runs as a matrix, so a thirty-module monorepo validates in parallel instead of
  serially.
- `docs-check: true` fails when a module's README table drifts from its variables, which
  today only pre-commit catches locally.

Adding plan/apply is new capability rather than a migration — see the
[Terraform monorepo recipe](RECIPES.md#terraform-monorepo). Set up two IAM roles, not one.

---

## agentic-toolkit → ai-* workflows

Different distribution models: agentic-toolkit is an installer that **copies** files into
your repo; this is a library you **reference**. That difference matters for the migration.

| agentic-toolkit | Here |
|---|---|
| `.github/actions/agent-run` (vendored) | `actions/agent-run@v1` (referenced), plus an `aider`/OpenRouter provider |
| `agent-code-review.yml` | `ai-pr-review.yml` |
| `agent-ready-trigger.yml` + `plan-approval-gate.yml` | `ai-agent-task.yml` with `complexity: high` for plan-first routing |
| `cost-report.yml` | `llm-cost-report.yml`, now including LLM spend alongside runner spend |
| `AGENT_PROVIDER` repository variable | `provider:` input on the workflow |
| `ENABLE_AGENT_REVIEW` variable | Delete the caller file, or gate it with `if:` |

**Keep the vendored parts that are genuinely yours.** `CLAUDE.md`, `docs/LEARNINGS.md`,
the issue and PR templates, and `LABELS.yml` are your institutional memory. They stay in
your repo. Only the workflow machinery moves.

**What doesn't have an equivalent yet:** `agent-retro.yml` (the compounding
learnings loop) and `auto-label-agent-ready.yml`. Keep those vendored from
agentic-toolkit; they can call `actions/agent-run@v1` instead of the local copy:

```yaml
-      uses: ./.github/actions/agent-run
+      uses: patrickisgreat/actions-toolkit/actions/agent-run@v1
```

Note the input names changed from snake_case to kebab-case in the move
(`claude_code_oauth_token` → `claude-code-oauth-token`), matching the rest of the toolkit.

---

## Any repo: the smallest useful first step

If a full pipeline swap is too much for one PR, adopt a single action. `aws-auth` is the
usual first one, because it replaces a static access-key pair with OIDC and that's worth
doing on its own:

```diff
-      - uses: aws-actions/configure-aws-credentials@v6
-        with:
-          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
-          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
-          aws-region: us-east-1
+      - uses: patrickisgreat/actions-toolkit/actions/aws-auth@v1
+        with:
+          aws-region: us-east-1
+          role-to-assume: arn:aws:iam::123456789012:role/gha-deploy
```

Add `id-token: write` to the job's permissions, delete the two secrets, and you've removed
a permanent credential from the repo. Build from there.

---

## Rollback

Every migration here is one file. If the toolkit pipeline misbehaves:

1. Revert the caller workflow. Your old one is in git history.
2. Or pin backwards: change `@v1` to the last release that worked (`@v1.3.0`).

The second is usually right — it isolates whether the problem is the toolkit or your
configuration, without giving up the migration.

---

## Checklist

- [ ] New workflow added alongside the old one, under a different name
- [ ] Compared both on a scratch PR — same failures, comparable duration
- [ ] Secrets exist under the names the mapping inputs expect
- [ ] `secrets: inherit` set if you use `build-env` / `env-map` / `provider-keys`
- [ ] `permissions:` includes `id-token: write` for cloud deploys, `pull-requests: write`
      for anything that comments
- [ ] Branch protection updated to the new job names
- [ ] Old workflow deleted
- [ ] Dependabot watching `github-actions` so the pin stays current
