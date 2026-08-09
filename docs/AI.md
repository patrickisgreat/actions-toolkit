# AI and ML pipelines

The provider matrix, why OpenRouter is the default, and how to keep spend bounded.

---

## What's here

| Piece | Kind | For |
|---|---|---|
| [`llm-call`](../actions/llm-call/) | action | One prompt, any provider. Release notes, triage, classification, summarisation. |
| [`agent-run`](../actions/agent-run/) | action | One agentic coding task. The provider seam. |
| [`llm-eval`](../actions/llm-eval/) | action | Run an eval suite, gate on pass rate and cost. |
| [`ml-artifact`](../actions/ml-artifact/) | action | Move models/datasets between the runner and S3/GCS/HF. |
| [`ai-pr-review`](WORKFLOWS.md#ai-pr-review) | workflow | Automated PR review. Opt-in, cost-aware. |
| [`ai-agent-task`](WORKFLOWS.md#ai-agent-task) | workflow | Issue → agent → PR, with plan-first routing. |
| [`ai-eval`](WORKFLOWS.md#ai-eval) | workflow | Eval gate on every PR, with baseline regression detection. |
| [`ml-pipeline`](WORKFLOWS.md#ml-pipeline) | workflow | Train → evaluate → register, gated on a metric. |
| [`llm-cost-report`](WORKFLOWS.md#llm-cost-report) | workflow | LLM spend + runner spend in one report. |

---

## Provider matrix

`llm-call` speaks four API shapes across eleven providers. Set `provider` and `model`.

| `provider` | Endpoint | Credential | Notes |
|---|---|---|---|
| `openrouter` *(default)* | `openrouter.ai/api/v1` | `OPENROUTER_API_KEY` | Hundreds of models, one key. Reports **real charged cost** per request. Server-side fallback routing. |
| `anthropic` | `api.anthropic.com/v1` | `ANTHROPIC_API_KEY` | Native Messages API. |
| `openai` | `api.openai.com/v1` | `OPENAI_API_KEY` | Chat Completions. |
| `gemini` | `generativelanguage.googleapis.com` | `GEMINI_API_KEY` | Note: its structured-output schema is a *subset* of JSON Schema. |
| `groq` | `api.groq.com/openai/v1` | `GROQ_API_KEY` | Very fast inference. |
| `together` | `api.together.xyz/v1` | `TOGETHER_API_KEY` | Open-weights hosting. |
| `deepseek` | `api.deepseek.com/v1` | `DEEPSEEK_API_KEY` | |
| `xai` | `api.x.ai/v1` | `XAI_API_KEY` | |
| `mistral` | `api.mistral.ai/v1` | `MISTRAL_API_KEY` | |
| `ollama` | `localhost:11434/v1` | none | Self-hosted, on a self-hosted runner. |
| `custom` | your `base-url` | optional | vLLM, LM Studio, LiteLLM, an internal gateway. |

### Why OpenRouter is the default

Three reasons, in order of how much they matter in CI:

1. **Outage and deprecation insulation.** `fallback-models` routes server-side, so a
   provider having a bad hour degrades your pipeline instead of failing it. When a model
   is retired you change one string, not a credential and an endpoint.
2. **Measured cost, not estimated.** OpenRouter returns the real charged cost per request,
   so `cost-usd` is a fact. On direct providers it's computed from prices you supply, and
   omitted entirely if you don't — a wrong number is worse than no number.
3. **One key.** Trying a different model doesn't mean provisioning another vendor account
   and adding another secret.

Direct providers are still first-class. Use them when you have committed spend, a data
processing agreement, or latency requirements that rule out a proxy hop.

```yaml
- uses: patrickisgreat/actions-toolkit/actions/llm-call@v1
  id: notes
  with:
    provider: openrouter
    api-key: ${{ secrets.OPENROUTER_API_KEY }}
    model: anthropic/claude-sonnet-5
    fallback-models: openai/gpt-5.2,google/gemini-3-pro
    system: You write terse, factual release notes.
    prompt-file: /tmp/commits.txt
    max-tokens: '2000'
```

### Structured output

`json-schema` constrains the model and validates the result before the step succeeds, so a
malformed response fails loudly instead of flowing into the next step as garbage:

```yaml
- uses: patrickisgreat/actions-toolkit/actions/llm-call@v1
  id: triage
  with:
    model: anthropic/claude-sonnet-5
    api-key: ${{ secrets.OPENROUTER_API_KEY }}
    prompt: ${{ github.event.issue.body }}   # safe: bound to env, never shell-interpolated
    json-schema: |
      {
        "type": "object",
        "properties": {
          "severity": { "type": "string", "enum": ["low", "medium", "high"] },
          "area":     { "type": "string" },
          "summary":  { "type": "string" }
        },
        "required": ["severity", "area", "summary"],
        "additionalProperties": false
      }

- run: gh issue edit "$N" --add-label "severity:$SEV"
  env:
    N: ${{ github.event.issue.number }}
    SEV: ${{ fromJSON(steps.triage.outputs.json).severity }}
```

---

## Eval gates

Prompts are code and they regress. A wording change that fixes one case quietly breaks
four others, and unit tests won't tell you — they test the code *around* the model.

```yaml
jobs:
  eval:
    uses: patrickisgreat/actions-toolkit/.github/workflows/ai-eval.yml@v1
    with:
      config: promptfooconfig.yaml
      threshold: '90'          # absolute floor
      max-regression: '2'      # …and no more than 2 points below the last main run
      max-cost-usd: '5.00'     # abort if the suite gets expensive
      publish-baseline: ${{ github.ref == 'refs/heads/main' }}
      provider-keys: |
        OPENROUTER_API_KEY=OPENROUTER_API_KEY
    secrets: inherit
```

**Why both a threshold and a regression budget.** A fixed threshold set generously at the
start never fires; the suite erodes from 98% to 91% one PR at a time and the gate stays
green. The baseline catches the erosion. The threshold catches the cliff.

**`publish-baseline` must be main-only.** Publishing from a PR would let a regression
overwrite the baseline it was supposed to be measured against. The expression above is the
correct form.

Not using promptfoo? `runner: custom` runs your command and reads the results through
`pass-rate-jq`, so DeepEval, Inspect, Braintrust, or a pytest harness all work:

```yaml
with:
  runner: custom
  command: 'uv run pytest tests/evals --json-report --json-report-file=eval-results.json'
  pass-rate-jq: '[(.summary.passed // 0), (.summary.failed // 0)]'
  python: true
```

---

## Agentic workflows

One repository-level choice — `provider` — swaps the agent. Everything else is identical.

| `provider` | Runs | Credential |
|---|---|---|
| `claude` *(default)* | Claude Code via `anthropics/claude-code-action` | `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` |
| `openai` | OpenAI Codex CLI, headless | `OPENAI_API_KEY` |
| `gemini` | Gemini CLI, headless | `GEMINI_API_KEY` |
| `aider` | Aider against **any OpenRouter model** | `OPENROUTER_API_KEY` |

`aider` is the bring-your-own-model path: `model: openrouter/deepseek/deepseek-v3` costs a
fraction of a frontier tier and is often fine for mechanical work. Claude Code drives git
itself; the other three are backed by a deterministic commit/push/open-PR safety net that
no-ops when the agent already did the work.

Read [SECURITY.md](SECURITY.md#agentic-workflows) before enabling these. The short version:
the agent runs full-auto, the containment is the job token, and it never merges its own work.

---

## Cost control

An AI workflow with no bounds is a billing incident waiting for a busy week. Every lever
below is on by default.

**In `ai-pr-review`:**

| Lever | Effect |
|---|---|
| No `synchronize` trigger | Reviews on open/reopen/ready only. **This is the big one** — leaving `synchronize` in re-runs a full review on every commit. |
| Draft skip | No spend on work-in-progress. |
| Dependabot skip | Its runs can't see Actions secrets anyway; the job could only fail. |
| Fork skip | Same. |
| `concurrency: cancel-in-progress` | You pay for the latest review, not every superseded one. |
| `paths-ignore` at the caller | Docs-only and lockfile-only PRs don't need a code review. |
| `default-model: sonnet` | A mid-tier model catches PR-level issues at a fraction of frontier cost. |
| `timeout-minutes` | A hard ceiling. |

**Everywhere else:** `max-turns` bounds agent loops, `max-cost-usd` aborts an expensive
eval suite, eval response caching skips unchanged cases, and `llm-call` reports per-call
cost so you can see where it goes.

**Watch the total:**

```yaml
on:
  schedule: [{ cron: '0 9 1 * *' }]
  workflow_dispatch:

jobs:
  cost:
    uses: patrickisgreat/actions-toolkit/.github/workflows/llm-cost-report.yml@v1
    with:
      days: 30
      issue-number: '42'   # sticky comment on a tracking issue
    secrets: inherit
```

It reports LLM spend *and* runner spend together, because the two trade off against each
other. An agent workflow that halves review time but triples runner minutes should be a
decision, not a surprise.

---

## ML pipelines

`ml-pipeline` is train → evaluate → register, where the last step is gated:

```yaml
jobs:
  train:
    uses: patrickisgreat/actions-toolkit/.github/workflows/ml-pipeline.yml@v1
    with:
      dataset-uri: s3://my-bucket/datasets/v3
      train-command: 'uv run python -m train --data "$DATASET_PATH" --out "$MODEL_PATH"'
      eval-command: 'uv run python -m evaluate --model "$MODEL_PATH" --out "$METRICS_FILE"'
      metric-jq: '.f1'
      metric-threshold: '0.85'
      metric-direction: higher
      registry-uri: hf://my-org/my-model
      aws-region: us-east-1
      aws-role-to-assume: arn:aws:iam::123456789012:role/gha-ml
      runs-on: gpu-runner
    secrets: inherit
    permissions: { contents: read, id-token: write }
```

Two things make this more than a shell script:

**The gate.** A model that got worse does not get registered. Without that, "publish the
artifact" is unconditional and a bad run silently becomes the thing you deploy.

**The manifest.** `ml-artifact` writes per-file SHA-256 checksums plus the producing commit
alongside the upload, and verifies them on download. That gives "which code and data
produced the weights in prod?" an answer, and turns a truncated transfer into a failed job
instead of a model trained on half a dataset.
