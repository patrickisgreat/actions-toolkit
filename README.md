# actions-toolkit

Reusable GitHub Actions building blocks — test, release, deploy, and AI/ML pipelines that
drop into any repo by reference, not by copy-paste.

Point a repo at a workflow and you get the whole pipeline. Change the pipeline here and
every repo on that major version gets the fix.

```yaml
# .github/workflows/ci.yml in your project
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

That's a lint-and-format gate, unit tests with coverage upload, a build, and Playwright
smoke tests on PRs with the full suite on `main` — in nine lines.

---

## Two layers

| | Use when | Example |
|---|---|---|
| **Composite actions** — `actions/<name>` | You're writing your own workflow and want one good building block | `uses: patrickisgreat/actions-toolkit/actions/aws-auth@v1` |
| **Reusable workflows** — `.github/workflows/<name>.yml` | You want an entire opinionated pipeline | `uses: patrickisgreat/actions-toolkit/.github/workflows/deploy-aws.yml@v1` |

The workflows are assembled from the actions, so you can start with a whole pipeline and
drop down to the pieces when your needs diverge — without a rewrite.

## Coverage

- **Clouds** — AWS (ECS, Lambda, S3+CloudFront), GCP (Cloud Run, GCS), Vercel, Fly.io,
  Supabase. OIDC / Workload Identity by default; no long-lived keys.
- **Stacks** — Node/pnpm/TypeScript, Python (uv + ruff + pytest), Terraform/OpenTofu, Go,
  Rust.
- **Infrastructure** — plan-on-PR / apply-on-merge with the reviewed plan carried between
  them, per-root matrices, drift-checked module docs. Pairs with
  [tf-tools](https://github.com/patrickisgreat/tf-tools).
- **AI/ML** — OpenRouter and every major LLM API behind one action, agentic PR review and
  issue→PR automation, prompt eval gates with regression detection, model/dataset
  registries, and combined LLM + runner cost reporting.

## Quick start

1. **Pick a pipeline** from the catalog below, or browse
   [docs/RECIPES.md](docs/RECIPES.md) for complete copy-paste stacks (Next.js + Supabase +
   Vercel, Python API on Cloud Run, a Terraform monorepo, an LLM app with eval gates).
2. **Add the caller workflow** to your repo. Five to fifteen lines.
3. **Set the secrets** the pipeline names. Every workflow documents exactly which, and
   fails fast with a message naming the missing one rather than a downstream 401.
4. **Pin to `@v1`.** See [docs/VERSIONING.md](docs/VERSIONING.md) for the guarantees that
   comes with.

## Documentation

| | |
|---|---|
| [docs/CONSUMING.md](docs/CONSUMING.md) | Pinning, secrets, `secrets: inherit`, permissions, and how the pieces fit together |
| [docs/WORKFLOWS.md](docs/WORKFLOWS.md) | Generated reference for every reusable workflow — inputs, secrets, outputs |
| [docs/RECIPES.md](docs/RECIPES.md) | Complete pipelines for real stacks, copy-paste ready |
| [docs/SECURITY.md](docs/SECURITY.md) | The trust boundary, OIDC setup with IAM/WIF policies, fork PRs, agent safety |
| [docs/AI.md](docs/AI.md) | Provider matrix, OpenRouter, eval gates, and keeping LLM spend bounded |
| [docs/VERSIONING.md](docs/VERSIONING.md) | What `@v1` promises, what counts as breaking, deprecation policy |
| [docs/MIGRATION.md](docs/MIGRATION.md) | Moving existing repos onto the toolkit |
| [docs/AUTHORING.md](docs/AUTHORING.md) | Adding an action or workflow to this repo |
| [CLAUDE.md](CLAUDE.md) | Operating guidance for agents and humans working *in* this repo |

## Catalog — reusable workflows

<!-- AUTOGEN:workflows -->
| Workflow | What it does |
|---|---|
| [`ai-agent-task`](docs/WORKFLOWS.md#ai-agent-task) | Issue → agent → pull request. |
| [`ai-eval`](docs/WORKFLOWS.md#ai-eval) | Run an LLM eval suite on every PR and gate the merge on it. |
| [`ai-pr-review`](docs/WORKFLOWS.md#ai-pr-review) | Automated PR review by whichever agent the repo is configured for. |
| [`cloudformation`](docs/WORKFLOWS.md#cloudformation) | CloudFormation change set on PRs, execute on merge — the same review gate the Terraform workflow gives you, for stacks CloudFormation owns. |
| [`deploy-aws`](docs/WORKFLOWS.md#deploy-aws) | One AWS deploy workflow, three targets, selected by `target`. |
| [`deploy-fly`](docs/WORKFLOWS.md#deploy-fly) | Deploy to Fly.io, with first-class support for per-PR ephemeral apps. |
| [`deploy-gcp`](docs/WORKFLOWS.md#deploy-gcp) | Deploy to Google Cloud — Cloud Run today, with the same auth/gating/notify shell as the AWS workflow so switching clouds doesn't mean relearning… |
| [`deploy-supabase`](docs/WORKFLOWS.md#deploy-supabase) | Supabase deploys: migrations, Edge Functions, and project config. |
| [`deploy-vercel`](docs/WORKFLOWS.md#deploy-vercel) | Deploy to Vercel and report back — a preview URL on the PR, a notification on production. |
| [`docker-build`](docs/WORKFLOWS.md#docker-build) | Build a container image, scan it, and push it — the job most deploy pipelines start with. |
| [`go-ci`](docs/WORKFLOWS.md#go-ci) | Go CI: gofmt gate, vet, golangci-lint, tests with race detection and coverage, and an optional cross-platform build matrix. |
| [`llm-cost-report`](docs/WORKFLOWS.md#llm-cost-report) | Where the money went: LLM spend plus GitHub Actions runner spend, over a window. |
| [`ml-pipeline`](docs/WORKFLOWS.md#ml-pipeline) | Train → evaluate → register. |
| [`node-ci`](docs/WORKFLOWS.md#node-ci) | Node/TypeScript CI: lint + format gate, unit tests with coverage, build, and an optional Playwright e2e stage. |
| [`python-ci`](docs/WORKFLOWS.md#python-ci) | Python CI: ruff lint + format gate, optional mypy, pytest with coverage, and an optional version matrix. |
| [`release-please`](docs/WORKFLOWS.md#release-please) | Conventional-commit releases via release-please, with the personal-repo auto-merge workaround that threaditate needed. |
| [`rust-ci`](docs/WORKFLOWS.md#rust-ci) | Rust CI: rustfmt gate, clippy with warnings denied, tests, and an optional MSRV check. |
| [`security-scan`](docs/WORKFLOWS.md#security-scan) | Security scanning: filesystem vulnerabilities, IaC misconfiguration, leaked secrets, and dependency review on PRs. |
| [`terraform-ci`](docs/WORKFLOWS.md#terraform-ci) | Terraform/OpenTofu CI: fmt, validate every root and example, tflint, trivy, and a terraform-docs drift check. |
| [`terraform-plan-apply`](docs/WORKFLOWS.md#terraform-plan-apply) | Terraform plan on PRs, apply on merge — the standard GitOps loop, with the plan artifact carried between them. |
<!-- /AUTOGEN:workflows -->

## Catalog — composite actions

<!-- AUTOGEN:actions -->
| Action | What it does |
|---|---|
| [`agent-run`](actions/agent-run/) | Run an agentic coding task with Claude Code, Codex, Gemini, or Aider/OpenRouter |
| [`aws-auth`](actions/aws-auth/) | Assume an AWS role via GitHub OIDC, or fall back to static access keys |
| [`changed-files`](actions/changed-files/) | Emit path filters and a changed-directory matrix for conditional monorepo jobs |
| [`cloudformation-deploy`](actions/cloudformation-deploy/) | Create, review, and execute a CloudFormation change set (or delete the stack) |
| [`deploy-aws-ecs`](actions/deploy-aws-ecs/) | Register a new ECS task definition with an updated image and roll the service |
| [`deploy-aws-lambda`](actions/deploy-aws-lambda/) | Update Lambda function code from an image, zip, or S3 object and move an alias |
| [`deploy-aws-static`](actions/deploy-aws-static/) | Sync a build directory to S3 with correct cache headers and invalidate CloudFront |
| [`deploy-cloud-run`](actions/deploy-cloud-run/) | Deploy a container image to Cloud Run, optionally as a traffic-split canary |
| [`deploy-fly`](actions/deploy-fly/) | Deploy an app to Fly.io, optionally creating it and staging secrets first |
| [`deploy-supabase`](actions/deploy-supabase/) | Apply migrations, deploy Edge Functions, and push config to a Supabase project |
| [`deploy-vercel`](actions/deploy-vercel/) | Build and deploy a project to Vercel (preview or production) via the Vercel CLI |
| [`docker-build-push`](actions/docker-build-push/) | Build, tag, cache, and push a container image to any registry |
| [`gcp-auth`](actions/gcp-auth/) | Authenticate to Google Cloud via Workload Identity Federation or an SA key |
| [`llm-call`](actions/llm-call/) | Send a prompt to OpenRouter, Anthropic, OpenAI, Gemini, or any OpenAI-compatible API |
| [`llm-eval`](actions/llm-eval/) | Run a promptfoo (or custom) LLM eval suite and gate on pass rate and cost |
| [`ml-artifact`](actions/ml-artifact/) | Upload or download model/dataset artifacts to S3, GCS, or the Hugging Face Hub |
| [`notify`](actions/notify/) | Post a status card to the job summary, Slack, and/or Discord |
| [`pr-comment`](actions/pr-comment/) | Create or update a sticky PR/issue comment identified by a marker |
| [`resolve-env`](actions/resolve-env/) | Resolve KEY=SECRET_NAME mappings into masked environment variables |
| [`setup-go`](actions/setup-go/) | Set up Go from go.mod, warm the module cache, and optionally install golangci-lint |
| [`setup-node`](actions/setup-node/) | Set up Node with pnpm/npm/yarn/bun auto-detection, caching, and dependency install |
| [`setup-python`](actions/setup-python/) | Set up Python with uv (or pip), caching, and a dependency install |
| [`setup-rust`](actions/setup-rust/) | Install a Rust toolchain with components and a warm cargo cache |
| [`setup-terraform`](actions/setup-terraform/) | Install Terraform or OpenTofu at a version resolved from the repo |
| [`terraform-apply`](actions/terraform-apply/) | Apply a saved Terraform/OpenTofu plan, or run a fresh auto-approved apply |
| [`terraform-plan`](actions/terraform-plan/) | Plan a Terraform/OpenTofu root and render a reviewable summary |
<!-- /AUTOGEN:actions -->

## The one thing to know about how this works

A reusable workflow cannot use `./actions/...` — inside a workflow called from another repo,
`./` resolves to the **caller's** checkout. So every reusable workflow here checks this
repository out at `job.workflow_sha` (the commit SHA of the workflow file being executed)
and references actions through that path:

```yaml
- uses: actions/checkout@v7
  with:
    repository: patrickisgreat/actions-toolkit
    ref: ${{ job.workflow_sha }}
    path: .toolkit
- uses: ./.toolkit/actions/setup-node
```

You never write this — it's inside the workflows. It matters because of what it guarantees:
pin a workflow to `@v1.4.0` and the actions it runs are v1.4.0's actions, not `main`'s.
Version drift between a workflow and the actions it calls is impossible by construction.

## Design principles

- **Parameterized, not forked.** One `deploy-aws.yml` with a `target` input, not three
  copies that drift.
- **Fail fast and say why.** A missing secret produces `::error::` naming it, not a 401
  four steps later.
- **Secure defaults.** OIDC over static keys (and a warning when you use keys anyway),
  read-only permissions unless a job needs more, no secrets in `run:` interpolation.
- **Cost-aware.** AI workflows skip drafts, forks, Dependabot, and docs-only changes;
  reviews don't re-run on every push; concurrency cancels superseded runs.
- **The docs can't rot.** Input tables are generated from the manifests and CI fails on
  drift.

## Contributing

```bash
brew install actionlint yamllint shellcheck
npm install
make all      # lint + validate + docs drift check — everything CI runs
```

Conventions are in [CLAUDE.md](CLAUDE.md); the authoring contract for new actions is in
[docs/AUTHORING.md](docs/AUTHORING.md). Conventional Commits, one concern per PR.

## License

MIT — see [LICENSE](LICENSE).
