"""Compare two eval results (Before / After).

uv run python evals/compare.py                     # the two latest results
uv run python evals/compare.py BEFORE.json AFTER.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

RESULTS_DIR = Path(__file__).resolve().parent / "results"


def all_results() -> list[Path]:
    return sorted(RESULTS_DIR.glob("*.json"))


def resolve(ref: str) -> Path:
    """'latest' -> newest result file; otherwise a path or a run id."""
    if ref == "latest":
        results = all_results()
        if not results:
            raise SystemExit("No previous eval results to compare with.")
        return results[-1]
    path = Path(ref)
    if not path.exists():
        path = RESULTS_DIR / f"{ref.removesuffix('.json')}.json"
    if not path.exists():
        raise SystemExit(f"Result not found: {ref}")
    return path


def case_status(case: dict[str, Any]) -> str:
    passed = sum(r["pass"] for r in case["runs"])
    return "PASS" if passed == len(case["runs"]) else "FAIL"


def print_comparison(before: dict[str, Any], after: dict[str, Any]) -> None:
    print(f"\n=== Compare  before={before['run_id']}  after={after['run_id']}\n")
    print(f"  {'':34s} {'Before':>8s} {'After':>8s}")
    keys = ["overall"] + sorted(k for k in set(before["summary"]) | set(after["summary"]) if k != "overall")
    for key in keys:
        b, a = before["summary"].get(key), after["summary"].get(key)
        fmt = lambda s: f"{s['rate']:.0%}" if s else "-"  # noqa: E731
        mark = ""
        if a and b:
            mark = "  ↑" if a["rate"] > b["rate"] else "  ↓ regression" if a["rate"] < b["rate"] else ""
        print(f"  {key:34s} {fmt(b):>8s} {fmt(a):>8s}{mark}")

    before_cases = {c["id"]: c for c in before["cases"]}
    changes = []
    for case in after["cases"]:
        prev = before_cases.get(case["id"])
        now = case_status(case)
        was = case_status(prev) if prev else "NEW"
        if was != now:
            changes.append(f"  {case['id']}: {was} → {now}")
    print("\nCase changes:" if changes else "\nCase changes: none")
    print("\n".join(changes))


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare two eval results")
    parser.add_argument("before", nargs="?")
    parser.add_argument("after", nargs="?")
    args = parser.parse_args()

    if args.before and args.after:
        before, after = resolve(args.before), resolve(args.after)
    else:
        results = all_results()
        if len(results) < 2:
            raise SystemExit("Need at least two results in evals/results/.")
        before, after = results[-2], results[-1]
    print_comparison(
        json.loads(before.read_text(encoding="utf-8")), json.loads(after.read_text(encoding="utf-8"))
    )


if __name__ == "__main__":
    main()
