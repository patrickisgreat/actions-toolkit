# Recipes

Complete, copy-paste pipelines for real stacks. Each is a whole file — change the names and
it works.

- [Next.js + Supabase + Vercel](#nextjs--supabase--vercel)
- [Containerised API on AWS ECS](#containerised-api-on-aws-ecs)
- [Python API on Cloud Run](#python-api-on-cloud-run)
- [Terraform monorepo](#terraform-monorepo)
- [CloudFormation stacks](#cloudformation-stacks)
- [Fly.io with per-PR preview apps](#flyio-with-per-pr-preview-apps)
- [LLM app with eval gates](#llm-app-with-eval-gates)
- [Library with automated releases](#library-with-automated-releases)
- [Agentic development loop](#agentic-development-loop)

---

## Next.js + Supabase + Vercel

The threaditate shape: CI on every PR, a preview deploy per PR, migrations reviewed before
they land, production on merge.

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push: { branches: [main] }
  pull_request:
  schedule:
    # Nightly full e2e catches drift in external dependencies that PR runs miss.
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
      e2e: auto           # smoke on PRs, full on main and the nightly cron
      build-env: |
        NEXT_PUBLIC_SUPABASE_URL=NEXT_PUBLIC_SUPABASE_URL
        NEXT_PUBLIC_SUPABASE_ANON_KEY=NEXT_PUBLIC_SUPABASE_ANON_KEY
        NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
      public-env: |
        NEXT_PUBLIC_DISABLE_POSTHOG=true
      required-env: NEXT_PUBLIC_SUPABASE_URL
    secrets: inherit

  # Schema changes get reviewed like code: the PR shows what a merge would apply.
  db-plan:
    if: github.event_name == 'pull_request'
    uses: patrickisgreat/actions-toolkit/.github/workflows/deploy-supabase.yml@v1
    with: { dry-run: true }
    permissions: { contents: read, pull-requests: write }
    secrets: inherit

  preview:
    if: github.event_name == 'pull_request'
    needs: [ci]
    uses: patrickisgreat/actions-toolkit/.github/workflows/deploy-vercel.yml@v1
    with:
      environment: preview
      build-env: |
        NEXT_PUBLIC_SUPABASE_URL=NEXT_PUBLIC_SUPABASE_URL
        NEXT_PUBLIC_SUPABASE_ANON_KEY=NEXT_PUBLIC_SUPABASE_ANON_KEY
    permissions: { contents: read, pull-requests: write }
    secrets: inherit
```

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push: { branches: [main] }

concurrency:
  # Never let two production deploys interleave.
  group: deploy-production
  cancel-in-progress: false

jobs:
  # Migrations before the app: new code against an unmigrated schema fails at runtime,
  # whereas an additive migration ahead of the deploy is safe.
  migrate:
    uses: patrickisgreat/actions-toolkit/.github/workflows/deploy-supabase.yml@v1
    with:
      migrate: true
      functions: all
      environment-name: production
    secrets: inherit

  release:
    needs: [migrate]
    uses: patrickisgreat/actions-toolkit/.github/workflows/deploy-vercel.yml@v1
    with:
      environment: production
      environment-name: production
      build-env: |
        NEXT_PUBLIC_SUPABASE_URL=NEXT_PUBLIC_SUPABASE_URL
        NEXT_PUBLIC_SUPABASE_ANON_KEY=NEXT_PUBLIC_SUPABASE_ANON_KEY
    secrets: inherit
```

**Secrets:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`,
`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `CODECOV_TOKEN`.

---

## Containerised API on AWS ECS

Build once, scan, push, deploy the digest. No static AWS credentials anywhere.

```yaml
# .github/workflows/deploy.yml
name: Build & deploy
on:
  push: { branches: [main] }
  pull_request:

env:
  ECR_HOST: 123456789012.dkr.ecr.us-east-1.amazonaws.com

jobs:
  ci:
    uses: patrickisgreat/actions-toolkit/.github/workflows/node-ci.yml@v1
    with: { e2e: none }
    secrets: inherit

  image:
    needs: [ci]
    uses: patrickisgreat/actions-toolkit/.github/workflows/docker-build.yml@v1
    with:
      registry: ecr
      registry-host: 123456789012.dkr.ecr.us-east-1.amazonaws.com
      image: my-api
      platforms: linux/amd64,linux/arm64
      # PRs validate that the image still builds without publishing it.
      push: ${{ github.event_name != 'pull_request' }}
      scan: true
      scan-fail: true
      provenance: true
      aws-region: us-east-1
      aws-role-to-assume: arn:aws:iam::123456789012:role/gha-ecr-push
    permissions: { contents: read, id-token: write, packages: write }

  deploy:
    needs: [image]
    if: github.ref == 'refs/heads/main'
    uses: patrickisgreat/actions-toolkit/.github/workflows/deploy-aws.yml@v1
    with:
      target: ecs
      cluster: production
      service: my-api
      container-name: api
      # The digest, not a tag — a tag can point somewhere else by the time this runs.
      image: ${{ needs.image.outputs.image-digest-ref }}
      wait-for-stability: true
      environment-name: production
      aws-region: us-east-1
      aws-role-to-assume: arn:aws:iam::123456789012:role/gha-ecs-deploy
    permissions: { contents: read, id-token: write }
    secrets: inherit
```

Add required reviewers to the `production` GitHub Environment and the deploy waits for
approval. See [SECURITY.md](SECURITY.md#aws-oidc-setup) for the IAM trust policy.

---

## Python API on Cloud Run

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push: { branches: [main] }
  pull_request:

jobs:
  ci:
    uses: patrickisgreat/actions-toolkit/.github/workflows/python-ci.yml@v1
    with:
      python-versions: '["3.11", "3.12", "3.13"]'
      mypy: true
      coverage-threshold: '85'
      services-compose: docker-compose.test.yml   # real Postgres, not a mock
    secrets: inherit

  security:
    uses: patrickisgreat/actions-toolkit/.github/workflows/security-scan.yml@v1
    permissions: { contents: read, security-events: write, pull-requests: write }

  image:
    needs: [ci]
    if: github.ref == 'refs/heads/main'
    uses: patrickisgreat/actions-toolkit/.github/workflows/docker-build.yml@v1
    with:
      registry: gar
      registry-host: us-central1-docker.pkg.dev
      image: my-project/containers/api
      gcp-workload-identity-provider: projects/123/locations/global/workloadIdentityPools/github/providers/github
      gcp-service-account: deployer@my-project.iam.gserviceaccount.com
    permissions: { contents: read, id-token: write }

  # Canary: 10% of traffic, then promote by hand once the dashboards look right.
  canary:
    needs: [image]
    uses: patrickisgreat/actions-toolkit/.github/workflows/deploy-gcp.yml@v1
    with:
      target: cloud-run
      service: my-api
      image: ${{ needs.image.outputs.image-digest-ref }}
      region: us-central1
      project-id: my-project
      traffic-percent: '10'
      min-instances: '1'
      memory: 512Mi
      secret-refs: |
        DATABASE_URL=database-url:latest
      workload-identity-provider: projects/123/locations/global/workloadIdentityPools/github/providers/github
      gcp-service-account: deployer@my-project.iam.gserviceaccount.com
    permissions: { contents: read, id-token: write }
    secrets: inherit
```

Promote with a `workflow_dispatch` job that calls the same workflow with `traffic-percent`
empty. Rolling back is doing nothing — the old revision is still serving 90%.

---

## Terraform monorepo

Pairs with [tf-tools](https://github.com/patrickisgreat/tf-tools).

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push: { branches: [main] }
  pull_request:

jobs:
  validate:
    uses: patrickisgreat/actions-toolkit/.github/workflows/terraform-ci.yml@v1
    with:
      directories: 'modules environments'
      docs-check: true      # terraform-docs tables must match the variables
      trivy-fail: false     # report while the backlog is triaged
```

```yaml
# .github/workflows/plan.yml
name: Terraform plan
on:
  pull_request:
    paths: ['environments/**', 'modules/**']

jobs:
  plan:
    uses: patrickisgreat/actions-toolkit/.github/workflows/terraform-plan-apply.yml@v1
    with:
      mode: plan
      # Only the roots that actually changed get planned.
      root-glob: 'environments/**'
      root-marker: main.tf
      # A read-only role scoped to `pull_request` — it cannot change anything.
      aws-role-to-assume: arn:aws:iam::123456789012:role/gha-terraform-plan
      aws-region: us-east-1
      fail-on-destroy: true
    permissions: { contents: read, pull-requests: write, id-token: write }
    secrets: inherit
```

```yaml
# .github/workflows/apply.yml
name: Terraform apply
on:
  push:
    branches: [main]
    paths: ['environments/**', 'modules/**']

concurrency:
  group: terraform-apply
  cancel-in-progress: false

jobs:
  apply:
    uses: patrickisgreat/actions-toolkit/.github/workflows/terraform-plan-apply.yml@v1
    with:
      mode: both            # plan then apply the plan it just produced
      root-glob: 'environments/**'
      root-marker: main.tf
      environment-name: production
      # A separate write role, reachable only through the production environment gate.
      aws-role-to-assume: arn:aws:iam::123456789012:role/gha-terraform-apply
      aws-region: us-east-1
    permissions: { contents: read, pull-requests: write, id-token: write }
    secrets: inherit
```

Two roles is the point: the plan role is read-only and reachable from any PR; the apply
role can change infrastructure and is reachable only after the environment's approval.

---

## CloudFormation stacks

Same review gate, for stacks CloudFormation owns. Change set on the PR, execute on merge.

```yaml
# .github/workflows/cfn-plan.yml
name: CloudFormation plan
on:
  pull_request:
    paths: ['infra/**']

jobs:
  plan:
    uses: patrickisgreat/actions-toolkit/.github/workflows/cloudformation.yml@v1
    with:
      mode: change-set
      # Ordered: the service stack imports the network stack's exports.
      stacks: |
        [
          {"stack-name": "myapp-network", "template": "infra/network.yaml"},
          {"stack-name": "myapp-data",    "template": "infra/data.yaml",
           "capabilities": "CAPABILITY_NAMED_IAM"},
          {"stack-name": "myapp-service", "template": "infra/service.yaml"}
        ]
      parameters: |
        Environment=production
      tags: |
        ManagedBy=github-actions
        Repository=${{ github.repository }}
      lint: true
      # A replacement on a stateful stack means data loss — block it and make someone look.
      fail-on-replacement: true
      aws-region: us-east-1
      aws-role-to-assume: arn:aws:iam::123456789012:role/gha-cfn-plan
    permissions: { contents: read, pull-requests: write, id-token: write }
    secrets: inherit
```

```yaml
# .github/workflows/cfn-deploy.yml
name: CloudFormation deploy
on:
  push:
    branches: [main]
    paths: ['infra/**']

concurrency:
  group: cfn-production
  cancel-in-progress: false

jobs:
  deploy:
    uses: patrickisgreat/actions-toolkit/.github/workflows/cloudformation.yml@v1
    with:
      mode: deploy
      stacks: |
        [
          {"stack-name": "myapp-network", "template": "infra/network.yaml"},
          {"stack-name": "myapp-data",    "template": "infra/data.yaml",
           "capabilities": "CAPABILITY_NAMED_IAM"},
          {"stack-name": "myapp-service", "template": "infra/service.yaml"}
        ]
      parameters: |
        Environment=production
      termination-protection: true
      environment-name: production
      aws-region: us-east-1
      aws-role-to-assume: arn:aws:iam::123456789012:role/gha-cfn-deploy
    permissions: { contents: read, pull-requests: write, id-token: write }
    secrets: inherit
```

**SAM or a template over 51,200 bytes?** Add `package: true` and an `s3-bucket`.
**Secret parameters?** Put them in the `CFN_SECRET_PARAMETERS` secret as `Key=Value` lines
rather than in `with:`. **Values that shouldn't be re-supplied on update?** Use
`MyParam=__USE_PREVIOUS__`.

---

## Fly.io with per-PR preview apps

Every PR gets its own app and URL; closing it tears the app down.

```yaml
# .github/workflows/preview.yml
name: PR preview
on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

jobs:
  deploy:
    if: github.event.action != 'closed'
    uses: patrickisgreat/actions-toolkit/.github/workflows/deploy-fly.yml@v1
    with:
      app: myapp
      app-suffix: -pr-${{ github.event.pull_request.number }}
      create-if-missing: true
      strategy: immediate
      region: iad
      secrets-map: |
        DATABASE_URL=PREVIEW_DATABASE_URL
    permissions: { contents: read, pull-requests: write }
    secrets: inherit

  # Without this, forgotten preview apps quietly accumulate on the bill.
  teardown:
    if: github.event.action == 'closed'
    uses: patrickisgreat/actions-toolkit/.github/workflows/deploy-fly.yml@v1
    with:
      app: myapp
      app-suffix: -pr-${{ github.event.pull_request.number }}
      destroy-on-close: true
    permissions: { contents: read, pull-requests: write }
    secrets: inherit
```

---

## LLM app with eval gates

Prompt changes get the same treatment as code changes.

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push: { branches: [main] }
  pull_request:

jobs:
  ci:
    uses: patrickisgreat/actions-toolkit/.github/workflows/python-ci.yml@v1
    secrets: inherit

  evals:
    uses: patrickisgreat/actions-toolkit/.github/workflows/ai-eval.yml@v1
    with:
      config: evals/promptfooconfig.yaml
      threshold: '90'          # absolute floor
      max-regression: '2'      # …and no more than 2 points below the last main run
      max-cost-usd: '5.00'
      # main-only: publishing from a PR would let a regression overwrite the baseline
      # it was supposed to be measured against.
      publish-baseline: ${{ github.ref == 'refs/heads/main' }}
      provider-keys: |
        OPENROUTER_API_KEY=OPENROUTER_API_KEY
    permissions: { contents: read, pull-requests: write, actions: read }
    secrets: inherit

  review:
    uses: patrickisgreat/actions-toolkit/.github/workflows/ai-pr-review.yml@v1
    with:
      provider: claude
      default-model: sonnet
      focus: Pay particular attention to prompt-injection surfaces and unbounded token usage.
    secrets: inherit
```

```yaml
# .github/workflows/cost.yml
name: Cost report
on:
  schedule: [{ cron: '0 9 1 * *' }]
  workflow_dispatch:

jobs:
  cost:
    uses: patrickisgreat/actions-toolkit/.github/workflows/llm-cost-report.yml@v1
    with:
      days: 30
      issue-number: '42'       # a tracking issue that gets a monthly comment
    permissions: { contents: read, actions: read, issues: write }
    secrets: inherit
```

---

## Library with automated releases

```yaml
# .github/workflows/release.yml
name: Release
on:
  push: { branches: [main] }

jobs:
  release:
    uses: patrickisgreat/actions-toolkit/.github/workflows/release-please.yml@v1
    with:
      release-type: node
      auto-merge: true
      # Only for repos consumers pin by major (an actions repo). Not for an app.
      move-major-tag: false
    permissions:
      contents: write
      pull-requests: write
      checks: read
      statuses: read
      actions: read
    secrets: inherit

  publish:
    needs: [release]
    if: needs.release.outputs.release-created == 'true'
    runs-on: ubuntu-latest
    permissions: { contents: read, id-token: write }
    steps:
      - uses: actions/checkout@v7
      - uses: patrickisgreat/actions-toolkit/actions/setup-node@v1
        with: { node-version: '22' }
      - run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

---

## Agentic development loop

Issue → agent → PR → review → merge. A human gates the start and the end.

```yaml
# .github/workflows/agent.yml
name: Agent
on:
  issues:
    types: [labeled]

jobs:
  implement:
    # Only a label applied by a human starts this — never "any new issue".
    if: github.event.label.name == 'agent-ready'
    uses: patrickisgreat/actions-toolkit/.github/workflows/ai-agent-task.yml@v1
    with:
      task: ${{ github.event.issue.body }}
      issue-number: ${{ github.event.issue.number }}
      issue-title: ${{ github.event.issue.title }}
      # High-complexity issues get a plan PR first, so a wrong approach is caught
      # before any code exists.
      complexity: ${{ contains(github.event.issue.labels.*.name, 'complexity:high') && 'high' || 'medium' }}
      provider: claude
      test-command: 'pnpm test:ci'
      max-turns: '60'
    permissions:
      contents: write
      pull-requests: write
      issues: write
      id-token: write
    secrets: inherit
```

Read [SECURITY.md](SECURITY.md#agentic-workflows) before enabling this. The issue body is
untrusted input; the containment is the job token, and the agent never merges its own work.
