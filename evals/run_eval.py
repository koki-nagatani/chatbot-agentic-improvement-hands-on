"""Run the eval suite against the current chatbot.

    uv run python evals/run_eval.py                          # full suite
    uv run python evals/run_eval.py --case hard-unknown-topic --case easy-pricing
    uv run python evals/run_eval.py --category hard --repeat 3
    uv run python evals/run_eval.py --compare latest         # also compare with the previous run

Results are saved to evals/results/<run_id>.json; traces to workspace/traces/eval/<run_id>/.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml

EVALS_DIR = Path(__file__).resolve().parent
ROOT = EVALS_DIR.parent
RESULTS_DIR = EVALS_DIR / "results"
sys.path.insert(0, str(ROOT / "apps" / "chatbot"))

import compare  # noqa: E402
from graders import DEFAULT_CRITERIA, doc_for_judge, judge, run_checks  # noqa: E402
from run import ask  # noqa: E402
from settings import TRACES_DIR, load_config, openai_client  # noqa: E402
from usage import metering  # noqa: E402


def load_cases(ids: list[str] | None, categories: list[str] | None) -> list[dict[str, Any]]:
    cases = yaml.safe_load((EVALS_DIR / "cases.yaml").read_text(encoding="utf-8"))
    if ids:
        unknown = set(ids) - {c["id"] for c in cases}
        if unknown:
            raise SystemExit(f"Unknown case id(s): {', '.join(sorted(unknown))}")
        cases = [c for c in cases if c["id"] in ids]
    if categories:
        cases = [c for c in cases if c["category"] in categories]
    return cases


def run_case(case: dict[str, Any], run_id: str) -> dict[str, Any]:
    trace_dir = TRACES_DIR / "eval" / run_id
    session_id = f"eval-{run_id}-{case['id']}"
    history: list[dict[str, str]] = []
    bot_cost = 0.0
    *setup_turns, question = case["turns"]
    for turn in setup_turns:
        t = ask(turn, history, session_id, trace_dir)
        bot_cost += t["usage"]["cost_usd"]
        history += [{"role": "user", "content": turn}, {"role": "assistant", "content": t["answer"]}]

    trace = ask(question, history, session_id, trace_dir)
    bot_cost += trace["usage"]["cost_usd"]
    answer = trace["answer"]
    retrieved_ids = [d["id"] for d in trace["retrieved_documents"]]

    checks = run_checks(case.get("checks", {}), answer, retrieved_ids)
    criteria = DEFAULT_CRITERIA + [c for c in case.get("criteria", []) if c not in DEFAULT_CRITERIA]
    with metering() as judge_meter:
        verdicts = judge(
            openai_client(),
            criteria=criteria,
            history=history,
            question=question,
            answer=answer,
            reference=case["reference"],
            retrieved_texts=[doc_for_judge(d) for d in trace["retrieved_documents"]],
        )
    return {
        "history": history,
        "question": question,
        "search_query": trace["search_query"],
        "retrieved": retrieved_ids,
        "answer": answer,
        "checks": checks,
        "judge": verdicts,
        "pass": all(c["pass"] for c in checks) and all(v["pass"] for v in verdicts),
        "trace_path": trace["trace_path"],
        "cost": {"bot_usd": round(bot_cost, 6), "judge_usd": judge_meter.summary()["cost_usd"]},
    }


def summarize(cases: list[dict[str, Any]]) -> dict[str, Any]:
    """Pass rates per category and per criterion. Each run counts once."""
    buckets: dict[str, list[bool]] = defaultdict(list)
    for case in cases:
        for run in case["runs"]:
            buckets["overall"].append(run["pass"])
            buckets[f"category:{case['category']}"].append(run["pass"])
            for v in run["judge"]:
                buckets[f"criterion:{v['criterion']}"].append(v["pass"])
            for c in run["checks"]:
                if c["check"] == "expected_docs":
                    buckets["criterion:retrieval"].append(c["pass"])
    return {
        k: {"passed": sum(v), "total": len(v), "rate": round(sum(v) / len(v), 3)} for k, v in buckets.items()
    }


def total_cost(cases: list[dict[str, Any]]) -> dict[str, float]:
    runs = [run for case in cases for run in case["runs"]]
    bot = sum(r["cost"]["bot_usd"] for r in runs)
    judge_ = sum(r["cost"]["judge_usd"] for r in runs)
    return {"bot_usd": round(bot, 6), "judge_usd": round(judge_, 6), "total_usd": round(bot + judge_, 6)}


def git_info() -> dict[str, Any]:
    def git(*args: str) -> str:
        return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True).stdout.strip()

    return {
        "commit": git("rev-parse", "--short", "HEAD"),
        "branch": git("branch", "--show-current"),
        "dirty": bool(git("status", "--porcelain", "apps/chatbot", "evals/cases.yaml")),
    }


def print_report(result: dict[str, Any]) -> None:
    s = result["summary"]
    o = s["overall"]
    print(f"\n=== Eval {result['run_id']}  ({len(result['cases'])} cases x {result['repeat']})")
    print(f"Overall: {o['passed']} / {o['total']} PASS  ({o['rate']:.0%})")
    c = result["cost"]
    print(f"Cost: ${c['total_usd']:.4f}  (bot ${c['bot_usd']:.4f} + judge ${c['judge_usd']:.4f})\n")
    for key in sorted(s):
        if key != "overall":
            print(f"  {key:34s} {s[key]['passed']:3d} / {s[key]['total']:3d}  {s[key]['rate']:.0%}")

    print()
    for case in result["cases"]:
        passed = sum(r["pass"] for r in case["runs"])
        status = "PASS" if passed == len(case["runs"]) else "FAIL"
        print(f"[{status}] {case['id']} ({passed}/{len(case['runs'])})")
        if status == "PASS":
            continue
        run = next(r for r in case["runs"] if not r["pass"])
        for c in run["checks"]:
            if not c["pass"]:
                extra = c.get("matched") or c.get("retrieved") or c.get("actual") or ""
                print(f"    check {c['check']}: {c['target']} {extra}")
        for v in run["judge"]:
            if not v["pass"]:
                print(f"    judge {v['criterion']}: {v['reason']}")
        print(f"    trace: {run['trace_path']}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run chatbot evals")
    parser.add_argument("--case", action="append", help="Run only this case id (repeatable)")
    parser.add_argument("--category", action="append", choices=["easy", "normal", "hard"])
    parser.add_argument("--repeat", type=int, default=1, help="Runs per case")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--label", help="Suffix for the run id, e.g. 'baseline'")
    parser.add_argument(
        "--compare", metavar="RESULT", help="Compare with a previous result file, or 'latest'"
    )
    args = parser.parse_args()

    cases = load_cases(args.case, args.category)
    previous = compare.resolve(args.compare) if args.compare else None
    run_id = datetime.now().strftime("%Y%m%d-%H%M%S") + (f"-{args.label}" if args.label else "")

    jobs = [(c, i) for c in cases for i in range(args.repeat)]
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        outputs = list(pool.map(lambda job: run_case(job[0], run_id), jobs))

    case_results = []
    for case in cases:
        runs = [out for (c, _), out in zip(jobs, outputs, strict=True) if c is case]
        case_results.append({"id": case["id"], "category": case["category"], "runs": runs})

    result = {
        "run_id": run_id,
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "repeat": args.repeat,
        "git": git_info(),
        "config": load_config(),
        "summary": summarize(case_results),
        "cost": total_cost(case_results),
        "cases": case_results,
    }
    RESULTS_DIR.mkdir(exist_ok=True)
    path = RESULTS_DIR / f"{run_id}.json"
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    print_report(result)
    print(f"\nSaved: {path.relative_to(ROOT)}")
    if previous:
        compare.print_comparison(json.loads(previous.read_text(encoding="utf-8")), result)


if __name__ == "__main__":
    main()
