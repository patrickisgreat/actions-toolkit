# Security

The trust boundary, the cloud auth setup, and the parts that need care — especially the
agentic workflows.

---

## The trust boundary

A GitHub Actions job is an ephemeral VM holding a scoped token and whatever secrets the
workflow gave it. The security of everything here reduces to two questions:

1. **What can this job's token do?** That is the `permissions:` block. It is the real
   boundary — not the action's internal logic, not the agent's judgement.
2. **Can an attacker get code to run in it?** That depends on the trigger and on whether
   untrusted input reaches a shell.

Everything below is downstream of those two.

---

## Defaults this repo commits to

| Control | How it's enforced |
|---|---|
| Least-privilege tokens | Every workflow declares `permissions: contents: read` and widens per job. Reviewer jobs are `contents: read` and cannot push. |
| No secrets in `run:` | `${{ }}` inside a `run:` body is substituted before bash parses it, so untrusted text becomes shell injection. `scripts/validate-manifests.mjs` fails the build on any occurrence; values are bound to `env:` instead. |
| OIDC over static keys | `aws-auth` and `gcp-auth` take a role/provider first. Passing a long-lived key still works but emits a `::warning::`. |
| Masked resolution | `resolve-env` and the secret-mapping inputs call `::add-mask::` on every value before writing it to `$GITHUB_ENV`. |
| Fork PRs skipped where credentialed | Any job needing a secret guards with `github.event.pull_request.head.repo.full_name == github.repository`. |
| Pinned dependencies | Every third-party `uses:` is pinned to a major tag at minimum, enforced by the validator; Dependabot keeps them current. |
| Strict shells | Every `run:` opens `set -euo pipefail`, enforced by the validator. A silent failure that reports success is a security problem, not just a bug. |

---

## AWS: OIDC setup

No access keys. The job exchanges its GitHub identity token for short-lived STS credentials.

**1. Register GitHub as an OIDC provider** (once per account):

```hcl
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  # AWS validates against its own trust store for this provider; the thumbprint is
  # vestigial but the API still requires one.
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}
```

**2. A role your workflow can assume.** The `sub` condition is the part that matters — get
it wrong and *any* repo on GitHub can assume your role:

```hcl
data "aws_iam_policy_document" "trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      # Scope to ONE repo, and ideally one ref. `repo:owner/*` would trust every repo you
      # own; `repo:*` would trust all of GitHub.
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:patrickisgreat/my-app:ref:refs/heads/main"]
    }
  }
}
```

Useful `sub` patterns, most to least restrictive:

| Pattern | Trusts |
|---|---|
| `repo:owner/name:ref:refs/heads/main` | Only `main` |
| `repo:owner/name:environment:production` | Only jobs running in that GitHub Environment — combine with required reviewers |
| `repo:owner/name:pull_request` | Only PR events (good for a read-only plan role) |
| `repo:owner/name:*` | Any ref or event in that repo |

The strong pattern is **two roles**: a read-only one scoped to `pull_request` for
`terraform plan`, and a write one scoped to `environment:production` for apply. The plan
role can't change anything, and the apply role can't be reached without passing the
environment's approval gate.

**3. Use it:**

```yaml
permissions: { contents: read, id-token: write }
steps:
  - uses: patrickisgreat/actions-toolkit/actions/aws-auth@v1
    with:
      aws-region: us-east-1
      role-to-assume: arn:aws:iam::123456789012:role/gha-deploy
```

`id-token: write` is required. Without it the job has no identity token to exchange and
you get a confusing "Credentials could not be loaded".

---

## GCP: Workload Identity Federation

Same idea, same warning about the attribute condition.

```hcl
resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  # Without this, ANY GitHub repository can mint tokens for this pool. It is not optional.
  attribute_condition = "assertion.repository == 'patrickisgreat/my-app'"

  oidc { issuer_uri = "https://token.actions.githubusercontent.com" }
}
```

Then bind the service account:

```hcl
resource "google_service_account_iam_member" "github" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/patrickisgreat/my-app"
}
```

```yaml
permissions: { contents: read, id-token: write }
steps:
  - uses: patrickisgreat/actions-toolkit/actions/gcp-auth@v1
    with:
      workload-identity-provider: projects/123/locations/global/workloadIdentityPools/github/providers/github
      service-account: deployer@my-project.iam.gserviceaccount.com
```

---

## Triggers, ranked by risk

| Trigger | Secrets? | Notes |
|---|---|---|
| `push` to a branch in the repo | Yes | Safe. Only people with write access can push. |
| `pull_request` from a branch | Yes | Safe. Same people. |
| `pull_request` from a **fork** | **No** | GitHub withholds secrets deliberately. Credentialed jobs must skip, not fail. |
| `issue_comment`, `issues` | Yes | Body is attacker-controlled. Never interpolate into `run:`; gate on commenter permission. |
| **`pull_request_target`** | **Yes** | **Runs with full secrets against a fork's code.** Never check out and execute the PR's code here. Most Actions supply-chain incidents are this. |

Nothing in this toolkit uses `pull_request_target`, and the agentic workflows explicitly
document that you must not either.

---

## Agentic workflows

`agent-run`, `ai-pr-review`, `ai-agent-task` run a coding agent in full-auto mode — Claude
`bypassPermissions`, Codex bypass-approvals, Gemini `--yolo`, Aider `--yes-always`.

**Why that's acceptable.** Headless CI cannot block on a tool-approval prompt, so the
choice is full-auto or nothing. The containment is not the agent's judgement; it is:

- an **ephemeral runner** — anything it does to the filesystem dies with the job,
- a **scoped job token** — `ai-pr-review` runs `contents: read` and *cannot push code*,
  whatever it decides to do,
- **no self-merge** — the agent opens a PR; a human merges it. That gate is not
  configurable, by design,
- a **timeout** — a hard ceiling on both runaway loops and spend.

**Prompt injection is real and handled explicitly.** An issue body is text written by
whoever opened the issue. `ai-agent-task` writes it to a file with `printf` and tells the
agent to treat it as data, with an explicit instruction not to follow directives inside it.
It never reaches a shell command line. This reduces the risk; it does not eliminate it — a
sufficiently persuasive issue could still steer an agent. The job token is what bounds the
damage, which is why `ai-agent-task` gets `contents: write` and nothing more.

**Before enabling agentic workflows on a repo:**

- [ ] The trigger is a label or a command from someone with write access — not "any issue".
- [ ] `permissions:` is the narrowest set the job needs.
- [ ] Not `pull_request_target`.
- [ ] `timeout-minutes` set.
- [ ] Branch protection prevents pushing to `main`, so the safety net can only open a PR.
- [ ] You've read [AI.md](AI.md) on cost controls — an unbounded agent loop is a billing
      incident before it's a security one.

---

## Reporting

Found something? Open a private security advisory on the repository rather than a public
issue.
