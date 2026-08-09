#!/usr/bin/env bash
#
# Verify every third-party `uses: owner/repo@ref` in this repo actually resolves.
#
# Why this exists as its own check: neither actionlint, yamllint, nor the manifest
# validator talks to GitHub, so a pin to a tag that does not exist is completely invisible
# to all three. It only surfaces when the step runs — and for an action that only runs in a
# credentialed deploy job, that means it surfaces in a consumer's production pipeline.
#
# It found `astral-sh/setup-uv@v9` that way: the project publishes `v9.0.0` but stopped
# publishing moving major tags after v7.6, so the conventional `@v9` was a dead reference.
#
# Refs to this repo are skipped — `@v1` legitimately does not exist until the first release.
#
# Usage: scripts/check-action-refs.sh        (needs `gh` authenticated)

set -euo pipefail

SELF_REPO='patrickisgreat/actions-toolkit'

if ! command -v gh > /dev/null 2>&1; then
  echo "::warning::gh is not installed — skipping the action-ref check."
  exit 0
fi

refs="$(grep -rhoE 'uses:[[:space:]]*[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+@[A-Za-z0-9_.-]+' \
          actions/ .github/workflows/ \
        | awk '{print $2}' \
        | grep -v "^${SELF_REPO}" \
        | sort -u)"

total=0
missing=0

while IFS= read -r use; do
  [ -n "$use" ] || continue
  total=$(( total + 1 ))
  ref="${use##*@}"
  # `owner/repo/sub/path@ref` resolves against `owner/repo`.
  owner_repo="$(printf '%s' "${use%@*}" | cut -d/ -f1,2)"

  if gh api "repos/${owner_repo}/git/ref/tags/${ref}"  > /dev/null 2>&1 ||
     gh api "repos/${owner_repo}/git/ref/heads/${ref}" > /dev/null 2>&1 ||
     # A full commit SHA has no ref; check the object exists instead.
     { [ "${#ref}" -eq 40 ] && gh api "repos/${owner_repo}/commits/${ref}" > /dev/null 2>&1; }; then
    printf '  ok       %s\n' "$use"
  else
    printf '  MISSING  %s\n' "$use"
    echo "::error title=Unresolvable action ref::${use} does not resolve. Check the project's tags — some stop publishing moving major tags."
    missing=$(( missing + 1 ))
  fi
done <<< "$refs"

echo
if [ "$missing" -eq 0 ]; then
  echo "✅ All ${total} third-party action ref(s) resolve."
  exit 0
fi
echo "❌ ${missing} of ${total} action ref(s) do not resolve."
exit 1
