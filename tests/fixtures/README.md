# Test fixtures

Minimal projects that `self-ci.yml` runs the actions and reusable workflows against.

They exist so the pipeline is exercised end-to-end rather than only linted. Static analysis
can tell you a `jq` filter parses; only running it tells you the filter produces the shape
the next step reads.

| Fixture | Exercises |
|---|---|
| `node-pnpm/` | `setup-node` package-manager detection, install, `node-ci` test + build stages |
| `python-uv/` | `setup-python` uv interpreter pinning and `uv sync` |
| `terraform/` | `setup-terraform`, and `terraform-ci` discovery → `init -backend=false` → `validate` |

Each carries a `marker.txt` used by the `changed-files` directory-matrix test.

Keep them dependency-free. A fixture that pulls packages turns a fast, hermetic CI job into
one that fails when a registry has a bad afternoon.
