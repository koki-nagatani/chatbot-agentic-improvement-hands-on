---
name: eval-driven-improvement
description: The mandatory procedure for changing the chatbot - baseline eval, regression case first, minimal change, full eval, Before/After comparison, iterate at most 3 times. Use whenever you are about to modify anything under apps/chatbot.
---

# Eval-driven improvement

Treat a reported problem like a bug: first a regression test, then the fix, then the full test suite.

## Procedure

1. **Baseline.** Find the result to compare against with `list_eval_results`. If the chatbot has
   changed since that result (`show_diff`), or no result exists, run the full suite with
   `run_eval` (label `before`) and use that run as Before.

2. **Regression case.** Before changing the bot, add an eval case to `evals/cases.yaml` that
   captures the reported problem. Follow the schema documented at the top of the file.
   - Write `reference` from the knowledge files, not from memory. Confirm facts with `search_files`.
   - Use deterministic `checks` where possible, and add the relevant judge `criteria`.
   - Run just that case with `run_eval` (`cases: [<id>]`) and confirm it **fails** on the
     current bot. A case that already passes does not capture the problem.
   - If an existing case already captures the problem, reuse it instead of adding a duplicate.

3. **Change.** Make the minimal change at the layer identified with the `rag-debugging` skill.
   Run `rebuild_index` if retrieval inputs changed.

4. **Targeted check.** Run the new case (and the cases closely related to it). Iterate here
   cheaply before running the full suite.

5. **Full eval.** Run the full suite with `compare_to` set to the Before run id. Look at:
   - the target case: FAIL → PASS?
   - regressions: any PASS → FAIL, or any criterion whose rate dropped

6. **Iterate.** If the target still fails or anything regressed, diagnose again and change again.
   Stop after **3 iterations** of change + full eval, and report honestly what is still failing.

7. **Report** (see below).

## Rules

- **Stay within the scope of the request.** Fix only the problem the user reported. If you
  discover other problems along the way (including the cause of an unrelated failing case),
  do not fix them. List them under 残課題 with your diagnosis and a proposed change, and let
  the user decide. The one exception: a regression your own change caused must be fixed.
- Judge regressions against the Before run. Cases that were already failing before your change
  are not regressions, even if they look related.
- **Never weaken existing eval cases** to make them pass. Don't change their `reference`,
  `checks`, or `criteria`, and don't delete them. You may only add new cases. If you believe an
  existing case is wrong, say so in the report and leave it to the user.
- You cannot and must not edit `evals/graders.py` or `evals/run_eval.py`.
- Report scores exactly as the tools printed them. Never estimate a score you did not run.
- LLM judges have some noise. If a single case flips with no related change, re-run it with
  `repeat: 3` before calling it a regression or an improvement.

## Report format

Reply in Japanese, concisely:

```text
■ 原因
<Symptom → root cause → layer, 2-4 lines>

■ 追加したEval
<case id>: <what it checks>

■ 変更内容
<file>: <what changed and why>

■ 結果
Before: <passed>/<total> (<rate>)
After:  <passed>/<total> (<rate>)
<target case>: FAIL → PASS
<criterion changes, regressions if any>

■ 残課題
<what still fails, next candidate changes>
```
