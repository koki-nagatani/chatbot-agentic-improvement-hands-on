"""Deterministic checks and LLM-judge criteria for eval cases."""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, Field

JUDGE_MODEL = "gpt-5.6-terra"

# correctness and groundedness are judged for every case.
DEFAULT_CRITERIA = ["correctness", "groundedness"]

CRITERIA: dict[str, str] = {
    "correctness": (
        "回答の結論と主要な事実が reference と矛盾していないか。"
        "reference の要点に反する記述や、質問への答えとして誤った結論があれば fail。"
    ),
    "groundedness": (
        "回答中の記事に関する事実（記事のタイトル・著者・公開日、手法・ツール・数値・推奨方針など）が、"
        "検索結果に書かれている内容で裏付けられるか。"
        "検索結果にない記事・内容・数値を断定している、検索結果の内容を拡大解釈している場合は fail。"
        "一般的な言い回しや、ブログに記載がない旨の案内は事実とみなさない。"
    ),
    "completeness": (
        "reference に挙げた要点のうち、質問に答えるために必要なものを回答が押さえているか。"
        "質問が複数の観点を含む場合、すべての観点に答えていなければ fail。"
    ),
    "conciseness": (
        "テックブログの案内Botとして端的か。単純な質問には結論と必要最小限の補足（目安として300字程度まで）で答える。"
        "聞かれていない記事や話題の列挙、長い箇条書き、記事の丸写しがあれば fail。"
    ),
    "unknown_handling": (
        "検索結果に十分な根拠がない事柄について、推測で断定せず、ブログ記事からはわからないことを明示しているか。"
        "該当記事が見つからないのに、存在しない記事や記事にない内容・数値を断定していれば fail。"
        "一般知識で補足する場合は、記事の内容ではないことが明確なら可。"
    ),
    "citation": (
        "回答の根拠にした記事を、タイトル（必要に応じて著者）で示しているか。"
        "出典を示していない、検索結果にない記事名を挙げている、タイトルや著者を取り違えている場合は fail。"
    ),
    "conversation_context": (
        "会話履歴を踏まえて、最後の質問の指示語や省略（「それ」「じゃあ〜は？」など）を正しく解釈して答えているか。"
        "文脈を取り違えた回答、文脈を無視した一般論の回答は fail。"
    ),
}


# ---------------------------------------------------------------- deterministic


def run_checks(checks: dict[str, Any], answer: str, retrieved_ids: list[str]) -> list[dict[str, Any]]:
    results = []
    for group in checks.get("must_include", []):
        ok = any(s in answer for s in group)
        results.append({"check": "must_include", "target": group, "pass": ok})
    for pattern in checks.get("must_not_include", []):
        m = re.search(pattern, answer, re.MULTILINE)
        results.append(
            {
                "check": "must_not_include",
                "target": pattern,
                "pass": m is None,
                **({"matched": m.group(0)} if m else {}),
            }
        )
    if prefixes := checks.get("expected_docs"):
        ok = any(i.startswith(tuple(prefixes)) for i in retrieved_ids)
        results.append({"check": "expected_docs", "target": prefixes, "pass": ok, "retrieved": retrieved_ids})
    if limit := checks.get("max_chars"):
        results.append(
            {"check": "max_chars", "target": limit, "pass": len(answer) <= limit, "actual": len(answer)}
        )
    return results


# ------------------------------------------------------------------- LLM judge


# Chunk metadata shown to the judge along with the text, when the chunk has it.
JUDGE_DOC_FIELDS = {"title": "タイトル", "author": "著者", "published": "公開日", "source": "URL"}


def doc_for_judge(doc: dict[str, Any]) -> str:
    """A retrieved chunk as the judge sees it: its metadata header, then its text."""
    header = "\n".join(f"{label}: {doc[key]}" for key, label in JUDGE_DOC_FIELDS.items() if doc.get(key))
    return f"{header}\n\n{doc['text']}" if header else doc["text"]


class CriterionVerdict(BaseModel):
    criterion: str
    reason: str = Field(description="判定理由を日本語で1〜2文")
    verdict: Literal["pass", "fail"]


class JudgeResult(BaseModel):
    verdicts: list[CriterionVerdict]


JUDGE_SYSTEM = """あなたは、松尾研究所テックブログの記事をもとに質問に答えるチャットボットの回答を
評価する厳格な評価者です。
指定された各評価基準について、pass か fail を判定してください。
reference は正解の要点、検索結果はチャットボットが回答時に参照できた情報です。"""


def judge(
    client,
    *,
    criteria: list[str],
    history: list[dict[str, str]],
    question: str,
    answer: str,
    reference: str,
    retrieved_texts: list[str],
) -> list[dict[str, Any]]:
    criteria_text = "\n".join(f"- {name}: {CRITERIA[name]}" for name in criteria)
    history_text = "\n".join(f"{m['role']}: {m['content']}" for m in history) or "（なし）"
    context_text = "\n\n---\n\n".join(retrieved_texts) or "（なし）"
    user = f"""# 評価基準
{criteria_text}

# 会話履歴
{history_text}

# 最後の質問
{question}

# 検索結果
{context_text}

# reference（正解の要点）
{reference}

# チャットボットの回答
{answer}"""
    resp = client.chat.completions.parse(
        model=JUDGE_MODEL,
        reasoning_effort="low",
        messages=[{"role": "system", "content": JUDGE_SYSTEM}, {"role": "user", "content": user}],
        response_format=JudgeResult,
    )
    by_name = {v.criterion: v for v in resp.choices[0].message.parsed.verdicts}
    return [
        {"criterion": name, "pass": by_name[name].verdict == "pass", "reason": by_name[name].reason}
        if name in by_name
        else {"criterion": name, "pass": False, "reason": "judge returned no verdict"}
        for name in criteria
    ]
