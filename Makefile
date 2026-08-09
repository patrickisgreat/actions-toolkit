# actions-toolkit developer tasks.
#
# Install the linters once:
#   brew install actionlint yamllint shellcheck
#   npm install

# SC2016 ("expressions don't expand in single quotes") is excluded repo-wide. Nearly every
# `run:` here embeds a single-quoted jq program whose `$name` references are jq variables,
# not shell ones, so the check is a false positive in essentially every instance and its
# noise would hide the findings that matter.
export SHELLCHECK_OPTS := --exclude=SC2016

.PHONY: help lint actionlint yamllint shellcheck validate check-refs docs docs-check test new-action all

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

all: lint validate check-refs docs-check ## Everything CI runs

lint: actionlint yamllint shellcheck ## Run every linter

actionlint: ## Lint workflow + action semantics (expressions, contexts, uses refs)
	actionlint -color

yamllint: ## Lint YAML syntax and style
	yamllint -c .yamllint.yml .github actions

shellcheck: ## Lint every `run:` block via actionlint's shellcheck integration
	@command -v shellcheck >/dev/null 2>&1 || { echo "shellcheck not installed"; exit 1; }
	@echo "shellcheck runs through actionlint; use 'make actionlint'."

validate: ## Structural checks on action.yml / workflow_call contracts
	node scripts/validate-manifests.mjs

check-refs: ## Verify every third-party `uses:` ref actually resolves (needs gh)
	./scripts/check-action-refs.sh

docs: ## Regenerate per-action READMEs and the root catalog table
	node scripts/gen-docs.mjs

docs-check: ## Fail if generated docs are stale (CI-friendly)
	node scripts/gen-docs.mjs --check

new-action: ## Scaffold a new composite action: make new-action NAME=deploy-foo
	@test -n "$(NAME)" || { echo "usage: make new-action NAME=<kebab-name>"; exit 1; }
	@test ! -d "actions/$(NAME)" || { echo "actions/$(NAME) already exists"; exit 1; }
	@mkdir -p "actions/$(NAME)"
	@sed 's/__NAME__/$(NAME)/g' templates/action.yml.tmpl > "actions/$(NAME)/action.yml"
	@echo "Created actions/$(NAME)/action.yml — fill it in, then 'make docs'."
