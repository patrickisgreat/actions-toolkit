# Consuming actions-toolkit

How to wire a repo to the toolkit, what to pin, and how secrets reach the pipelines.

---

## The two ways to consume

### A whole pipeline — reusable workflow

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push: { branches: [main] }
  pull_request:

jobs:
  ci:
    uses: patrickisgreat/actions-toolkit/.github/workflows/node-ci.yml@v1
    with:
      node-version: '22'
      e2e: auto
    secrets: inherit
```

Constraints GitHub imposes on called workflows, worth knowing before you fight them:

- A `uses:` job **cannot have `steps:`**. If you need a step before or after, make it a
  separate job and wire it with `needs:`.
- `if:`, `needs:`, `with:`, `secrets:`, `permissions:`, and `strategy:` are allowed.
- Nesting is capped at four levels. This repo consumes one level, so you have three.
- `permissions:` on the caller can only *narrow* what the workflow requests, never widen.

### One building block — composite action

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions: { contents: read, id-token: write }
    steps:
      - uses: actions/checkout@v7
      - uses: patrickisgreat/actions-toolkit/actions/aws-auth@v1
        with:
          aws-region: us-east-1
          role-to-assume: arn:aws:iam::123456789012:role/gha-deploy
      - run: aws s3 ls
```

Reach for this when a workflow is close but not right. You keep the pieces that work and
write the rest yourself, instead of forking a whole pipeline over one difference.

---

## Pinning

| Pin | You get | Use it when |
|---|---|---|
| `@v1` | Latest `1.x`, picked up automatically | Default. You want fixes without a PR. |
| `@v1.4.0` | Exactly that release, frozen | Regulated pipelines, or you're debugging. |
| `@<40-char-sha>` | Exactly that commit | Maximum supply-chain paranoia. |
| `@main` | Whatever just merged | Never, outside this repo's own CI. |

`@v1` moves. Every merge to `main` here that cuts a release repoints `v1`, so a change
lands in your repo on its next run without you doing anything. That's the point, and it's
also the risk — [VERSIONING.md](VERSIONING.md) covers what is and isn't allowed to change
under a major.

Dependabot keeps pins current if you tell it to look:

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: weekly }
```

---

## Secrets

### `secrets: inherit` versus explicit

```yaml
# Everything the caller has, forwarded.
secrets: inherit

# Or name them — the called workflow sees nothing else.
secrets:
  VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
  CODECOV_TOKEN: ${{ secrets.MY_CODECOV_TOKEN }}
```

`inherit` is convenient and is what the examples use. Be aware it forwards **all** your
repo and environment secrets to the called workflow, not just the declared ones. For a
toolkit you control that's fine. For a third-party workflow it would not be.

One catch: features that resolve secrets *by name* — `build-env`, `env-map`,
`provider-keys`, `secrets-map` — read `toJSON(secrets)`, which only contains what the
workflow can see. **Those inputs require `secrets: inherit`.** With explicit secrets they
silently resolve to nothing (you'll get a `::warning::` naming the variable).

### Name mapping

Reusable workflows can't know what you called your secrets, so several accept a mapping:

```yaml
with:
  build-env: |
    NEXT_PUBLIC_SUPABASE_URL=SUPABASE_URL          # env var = secret name
    NEXT_PUBLIC_SUPABASE_ANON_KEY=SUPABASE_ANON_KEY
    DATABASE_URL                                    # same name on both sides
  required-env: NEXT_PUBLIC_SUPABASE_URL            # fail if this one is missing
```

Resolved values are `::add-mask::`ed before they're written, so they're redacted in every
later log line. Non-secret configuration should go in `public-env` instead — masking a
value that appears in your HTML just fills the log with `***`.

---

## Permissions

Every workflow declares `permissions: contents: read` at the top and widens per job. You
usually don't need to think about it, with three exceptions:

| You're doing | Add to the caller job |
|---|---|
| Cloud deploys (OIDC) | `id-token: write` |
| PR comments (plan output, eval scores, preview URLs) | `pull-requests: write` |
| Security scans that upload SARIF | `security-events: write` |

```yaml
jobs:
  deploy:
    uses: patrickisgreat/actions-toolkit/.github/workflows/deploy-aws.yml@v1
    permissions:
      contents: read
      id-token: write
    with: { target: ecs, aws-region: us-east-1, ... }
```

A caller's `permissions:` block can only narrow the workflow's request. If a job fails with
"Resource not accessible by integration", the caller is too restrictive.

---

## How the pieces fit together

The reusable workflows compose the composite actions, and you can compose the workflows:

```yaml
jobs:
  ci:
    uses: patrickisgreat/actions-toolkit/.github/workflows/node-ci.yml@v1
    secrets: inherit

  image:
    needs: [ci]
    if: github.ref == 'refs/heads/main'
    uses: patrickisgreat/actions-toolkit/.github/workflows/docker-build.yml@v1
    with:
      registry: ecr
      registry-host: 123456789012.dkr.ecr.us-east-1.amazonaws.com
      aws-region: us-east-1
      aws-role-to-assume: arn:aws:iam::123456789012:role/gha-push
    permissions: { contents: read, id-token: write }

  deploy:
    needs: [image]
    uses: patrickisgreat/actions-toolkit/.github/workflows/deploy-aws.yml@v1
    with:
      target: ecs
      cluster: prod
      service: api
      # Deploy the digest, not a tag: tags are mutable and can point somewhere else by
      # the time the deploy runs.
      image: ${{ needs.image.outputs.image-digest-ref }}
      environment-name: production
      aws-region: us-east-1
      aws-role-to-assume: arn:aws:iam::123456789012:role/gha-deploy
    permissions: { contents: read, id-token: write }
```

More complete stacks are in [RECIPES.md](RECIPES.md).

---

## The `.toolkit` checkout

Every reusable workflow job starts with:

```yaml
- uses: actions/checkout@v7
  with:
    repository: patrickisgreat/actions-toolkit
    ref: ${{ github.job_workflow_sha || 'main' }}
    path: .toolkit
```

You never write this, but you'll see it in logs and it explains two things.

**Why it exists.** Inside a workflow called from another repo, `./` resolves to the
*caller's* checkout, so a reusable workflow cannot reference its own repo's actions by
relative path. The toolkit has to clone itself.

**Why the ref is `github.job_workflow_sha`.** That's the commit SHA of the reusable workflow
file currently executing. Pin `@v1.4.0` and the actions it runs are v1.4.0's actions. A
workflow can never drift from the actions it calls.

Consequences for you:

- A `.toolkit` directory appears in the workspace during the run. It's gitignored in this
  repo; add it to yours if a build step globs everything.
- The extra checkout costs a second or two per job.
- Fork PRs calling a *local* copy of these workflows will fail this checkout, because the
  SHA lives in the fork. Consuming from `patrickisgreat/actions-toolkit@v1` is unaffected.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Resource not accessible by integration` | Caller `permissions:` too narrow. See the table above. |
| `::warning::'X' maps to secret 'Y', which is unset` | Either the secret doesn't exist, or you used explicit `secrets:` instead of `inherit`. |
| Deploy job authenticates but gets 403 from AWS/GCP | OIDC worked, the role's *policy* is too narrow. See [SECURITY.md](SECURITY.md). |
| Everything skipped on a Dependabot PR | Deliberate. Dependabot runs use a separate secret store that can't see Actions secrets, so credentialed jobs can only fail. |
| `fatal: could not read Username` on the `.toolkit` checkout | The toolkit repo is private to the caller. Make it public, or pass a token with read access. |
| Format gate fails but the code looks formatted | Your formatter changed a file the gate doesn't ignore. Check `format-ignore`. |
