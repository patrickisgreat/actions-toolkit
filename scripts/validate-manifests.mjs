#!/usr/bin/env node
/**
 * Structural checks on this repo's action and workflow contracts.
 *
 * actionlint validates Actions *syntax*. This validates the conventions that make the
 * toolkit safe and consistent for consumers — the things that are legal YAML and still
 * wrong here. Every rule below exists because breaking it produces a real failure:
 *
 *   • shell-injection      `${{ }}` inside a `run:` body is string substitution before the
 *                          shell ever sees it, so an issue title containing `$(…)` executes.
 *   • strict-mode          A `run:` without `set -euo pipefail` continues after a failed
 *                          command and reports success.
 *   • no-local-action-refs A composite action that `uses:` a sibling by relative path
 *                          resolves against the *consumer's* checkout, so it works in this
 *                          repo's tests and breaks for everyone else.
 *   • toolkit-checkout     A reusable workflow using `./.toolkit/...` must have checked the
 *                          toolkit out at `github.job_workflow_sha`, or a consumer pinned to
 *                          `@v1` silently runs `main`'s actions.
 *   • pinned-uses          An unpinned third-party action is a supply-chain hole.
 *   • documented           Undescribed inputs and outputs produce useless generated docs.
 *
 * Usage: node scripts/validate-manifests.mjs
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ACTIONS_DIR = join(ROOT, 'actions');
const WORKFLOWS_DIR = join(ROOT, '.github', 'workflows');

/** Workflows in this repo that are ours, not reusable library workflows. */
const SELF_WORKFLOW_PREFIX = 'self-';

/** `uses:` values allowed to be unpinned, because they track a moving branch upstream. */
const UNPINNED_ALLOWLIST = new Set(['superfly/flyctl-actions/setup-flyctl@master']);

const problems = [];
let checked = 0;

function fail(file, rule, message) {
  problems.push({ file: relative(ROOT, file), rule, message });
}

function listDirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => join(dir, name))
    .filter((p) => statSync(p).isDirectory());
}

function listYaml(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => join(dir, f));
}

/**
 * Walk every step in a parsed action or workflow, yielding `{ step, path }`.
 * Composite actions keep steps at `runs.steps`; workflows nest them under each job.
 */
function* eachStep(doc) {
  if (doc?.runs?.steps) {
    for (const [i, step] of doc.runs.steps.entries()) {
      yield { step, path: `runs.steps[${i}]`, job: null };
    }
  }
  for (const [jobName, job] of Object.entries(doc?.jobs ?? {})) {
    for (const [i, step] of (job?.steps ?? []).entries()) {
      yield { step, path: `jobs.${jobName}.steps[${i}]`, job: jobName, jobDef: job };
    }
  }
}

// ── Shared step-level rules ────────────────────────────────────────────────────────────

function checkStep(file, { step, path }) {
  const label = `${path}${step.name ? ` ("${step.name}")` : ''}`;

  if (typeof step.run === 'string') {
    // shell-injection: `${{ }}` is substituted into the script text before bash parses it.
    const interpolations = step.run.match(/\$\{\{[^}]*\}\}/g);
    if (interpolations) {
      fail(
        file,
        'shell-injection',
        `${label} interpolates ${interpolations.length} expression(s) directly into 'run:' ` +
          `(${interpolations[0].trim()}…). Bind them to 'env:' and reference the variable.`,
      );
    }

    // strict-mode: only meaningful for bash, which is the default and the only shell used here.
    const shell = step.shell ?? 'bash';
    if (shell === 'bash' && !/^\s*set -euo pipefail\s*$/m.test(step.run)) {
      fail(file, 'strict-mode', `${label} has a 'run:' block that does not 'set -euo pipefail'.`);
    }
  }

  if (typeof step.uses === 'string') {
    const uses = step.uses.trim();
    const isLocal = uses.startsWith('./') || uses.startsWith('../');
    if (!isLocal && !uses.startsWith('docker://')) {
      // pinned-uses: require at least `@vN`; a bare ref or a branch name is not a pin.
      const at = uses.lastIndexOf('@');
      const ref = at === -1 ? '' : uses.slice(at + 1);
      const pinned = /^(v\d+(\.\d+)*(-[\w.]+)?|[0-9a-f]{40}|\d+(\.\d+)*)$/.test(ref);
      if (!pinned && !UNPINNED_ALLOWLIST.has(uses)) {
        fail(
          file,
          'pinned-uses',
          `${label} uses '${uses}', which is not pinned to a version tag or SHA.`,
        );
      }
    }
  }
}

// ── Composite actions ──────────────────────────────────────────────────────────────────

for (const dir of listDirs(ACTIONS_DIR)) {
  const file = join(dir, 'action.yml');
  if (!existsSync(file)) {
    fail(dir, 'missing-manifest', 'Directory under actions/ has no action.yml.');
    continue;
  }
  checked += 1;

  let doc;
  try {
    doc = parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail(file, 'parse-error', error.message);
    continue;
  }

  // `manifest-expressions`: GitHub evaluates `${{ }}` ANYWHERE in an action manifest,
  // including inside a `description:`. Two ways that bites:
  //   • The `secrets` context does not exist in a composite action, so merely *mentioning*
  //     `${{ toJSON(secrets) }}` in a description fails the action at load time with
  //     "Unrecognized named-value: 'secrets'" — for every consumer, not just here.
  //   • A description is documentation; an expression in one is never intentional.
  // There is no escape sequence for `${{`, so the fix is always to reword the prose.
  {
    const source = readFileSync(file, 'utf8');
    for (const [i, line] of source.split('\n').entries()) {
      const expressions = line.match(/\$\{\{([^}]*)\}\}/g);
      if (!expressions) continue;

      const isDescription = /^\s*description:/.test(line);
      const isComment = /^\s*#/.test(line);
      if (isComment) continue;

      if (isDescription) {
        fail(
          file,
          'manifest-expressions',
          `Line ${i + 1}: a 'description:' contains ${expressions[0].trim()}. GitHub evaluates ` +
            `expressions in descriptions too — reword the prose instead.`,
        );
      }
      for (const expression of expressions) {
        // Only the bare `secrets` context is illegal. An input legitimately *named*
        // secrets — `inputs.secrets`, `inputs.secrets-json` — is a property access and fine.
        if (/(^|[^.\w-])secrets(?![\w-])/.test(expression)) {
          fail(
            file,
            'manifest-expressions',
            `Line ${i + 1}: ${expression.trim()} references the 'secrets' context, which does ` +
              `not exist inside a composite action. Take the value as an input instead.`,
          );
        }
      }
    }
  }

  if (!doc?.name) fail(file, 'documented', "Missing top-level 'name'.");
  if (!doc?.description) fail(file, 'documented', "Missing top-level 'description'.");
  if (doc?.runs?.using !== 'composite') {
    fail(file, 'composite-only', `runs.using is '${doc?.runs?.using}'; this repo only ships composite actions.`);
  }

  for (const [name, input] of Object.entries(doc?.inputs ?? {})) {
    if (!input?.description) {
      fail(file, 'documented', `Input '${name}' has no description.`);
    }
    // An optional input without an explicit default reads as empty-string in `${{ }}` but
    // as undefined in some contexts; being explicit removes the ambiguity.
    if (!input?.required && input?.default === undefined) {
      fail(file, 'documented', `Optional input '${name}' has no explicit default.`);
    }
    if (/_/.test(name)) {
      fail(file, 'naming', `Input '${name}' uses snake_case; action inputs here are kebab-case.`);
    }
  }

  for (const [name, output] of Object.entries(doc?.outputs ?? {})) {
    if (!output?.description) fail(file, 'documented', `Output '${name}' has no description.`);
    if (output?.value === undefined) {
      fail(file, 'documented', `Output '${name}' has no 'value' (required for composite actions).`);
    }
  }

  for (const entry of eachStep(doc)) {
    checkStep(file, entry);

    // no-local-action-refs: see the header comment.
    const uses = entry.step?.uses;
    if (typeof uses === 'string' && (uses.startsWith('./') || uses.startsWith('../'))) {
      fail(
        file,
        'no-local-action-refs',
        `${entry.path} uses '${uses}'. Composite actions must not reference other actions ` +
          `in this repo — relative paths resolve against the consumer's checkout. Compose ` +
          `in a reusable workflow instead.`,
      );
    }
  }
}

// ── Reusable workflows ─────────────────────────────────────────────────────────────────

for (const file of listYaml(WORKFLOWS_DIR)) {
  const base = file.split('/').pop();
  const isSelf = base.startsWith(SELF_WORKFLOW_PREFIX);
  checked += 1;

  let doc;
  try {
    doc = parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail(file, 'parse-error', error.message);
    continue;
  }

  // `on:` parses as the boolean `true` under YAML 1.1 unless quoted; the `yaml` package
  // follows 1.2 and keeps it a string, but accept both so this doesn't depend on that.
  const triggers = doc?.on ?? doc?.true ?? {};
  const isReusable = Object.prototype.hasOwnProperty.call(triggers, 'workflow_call');

  if (!isSelf && !isReusable) {
    fail(
      file,
      'naming',
      `Workflow is not reusable ('on: workflow_call') and is not prefixed '${SELF_WORKFLOW_PREFIX}'. ` +
        `Library workflows must be reusable; this repo's own workflows must be prefixed.`,
    );
  }

  for (const [name, input] of Object.entries(triggers?.workflow_call?.inputs ?? {})) {
    if (!input?.description) fail(file, 'documented', `Input '${name}' has no description.`);
    if (!input?.type) fail(file, 'documented', `Input '${name}' has no 'type'.`);
  }
  for (const [name, output] of Object.entries(triggers?.workflow_call?.outputs ?? {})) {
    if (!output?.description) fail(file, 'documented', `Output '${name}' has no description.`);
  }

  // toolkit-checkout: any job reaching into `./.toolkit/` must have cloned it correctly.
  for (const [jobName, job] of Object.entries(doc?.jobs ?? {})) {
    const steps = job?.steps ?? [];
    const usesToolkit = steps.some((s) => typeof s?.uses === 'string' && s.uses.startsWith('./.toolkit/'));
    if (!usesToolkit) continue;

    const checkoutStep = steps.find(
      (s) =>
        typeof s?.uses === 'string' &&
        s.uses.startsWith('actions/checkout@') &&
        s?.with?.path === '.toolkit',
    );

    if (!checkoutStep) {
      fail(
        file,
        'toolkit-checkout',
        `Job '${jobName}' uses './.toolkit/...' but never checks the toolkit out to '.toolkit'.`,
      );
      continue;
    }
    if (checkoutStep.with?.repository !== 'patrickisgreat/actions-toolkit') {
      fail(
        file,
        'toolkit-checkout',
        `Job '${jobName}' checks out '${checkoutStep.with?.repository}' into .toolkit; expected patrickisgreat/actions-toolkit.`,
      );
    }
    const ref = String(checkoutStep.with?.ref ?? '');
    if (!ref.includes('github.job_workflow_sha')) {
      fail(
        file,
        'toolkit-checkout',
        `Job '${jobName}' pins the .toolkit checkout to '${ref}'. It must use ` +
          `\${{ github.job_workflow_sha || github.sha }} so actions match the workflow version the caller pinned.`,
      );
    }

    // The checkout must come before the first use, or the path doesn't exist yet.
    const checkoutIndex = steps.indexOf(checkoutStep);
    const firstUse = steps.findIndex((s) => typeof s?.uses === 'string' && s.uses.startsWith('./.toolkit/'));
    if (firstUse < checkoutIndex) {
      fail(
        file,
        'toolkit-checkout',
        `Job '${jobName}' uses './.toolkit/...' at step ${firstUse} before checking it out at step ${checkoutIndex}.`,
      );
    }
  }

  for (const entry of eachStep(doc)) {
    checkStep(file, entry);

    // Local refs are only valid through the .toolkit checkout — but only in *reusable*
    // workflows. This repo's own `self-` workflows run here, where GITHUB_WORKSPACE is the
    // toolkit itself, so `./actions/...` is both correct and the thing being tested.
    const uses = entry.step?.uses;
    if (!isSelf && typeof uses === 'string' && uses.startsWith('./') && !uses.startsWith('./.toolkit/')) {
      fail(
        file,
        'toolkit-checkout',
        `${entry.path} uses '${uses}'. Inside a reusable workflow './' is the *caller's* ` +
          `checkout — reference toolkit actions as './.toolkit/actions/<name>'.`,
      );
    }
  }
}

// ── Report ─────────────────────────────────────────────────────────────────────────────

if (problems.length === 0) {
  console.log(`✅ ${checked} manifest(s) validated, no problems found.`);
  process.exit(0);
}

const byFile = new Map();
for (const p of problems) {
  if (!byFile.has(p.file)) byFile.set(p.file, []);
  byFile.get(p.file).push(p);
}

console.error(`❌ ${problems.length} problem(s) across ${byFile.size} file(s):\n`);
for (const [file, items] of byFile) {
  console.error(`  ${file}`);
  for (const item of items) {
    console.error(`    [${item.rule}] ${item.message}`);
    // Annotate in the Actions log so the failure is visible on the file itself.
    if (process.env.GITHUB_ACTIONS) {
      console.log(`::error file=${file},title=${item.rule}::${item.message.replace(/\n/g, ' ')}`);
    }
  }
  console.error('');
}
process.exit(1);
