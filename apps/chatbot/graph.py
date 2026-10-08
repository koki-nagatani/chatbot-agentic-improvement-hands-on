"""LangGraph RAG chatbot: START -> retrieve -> generate -> END."""

from __future__ import annotations

from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from retriever import search
from settings import load_config, load_prompt, openai_client


class State(TypedDict, total=False):
    question: str
    history: list[dict[str, str]]  # [{"role": "user"|"assistant", "content": ...}]
    search_query: str
    context: list[dict[str, Any]]
    answer: str


def retrieve(state: State) -> State:
    query = state["question"]
    return {"search_query": query, "context": search(query)}


def generate(state: State) -> State:
    config = load_config()
    context = "\n\n".join(doc["text"] for doc in state["context"])
    messages = [
        {"role": "system", "content": load_prompt("system")},
        *state.get("history", []),
        {
            "role": "user",
            "content": load_prompt("answer").format(context=context, question=state["question"]),
        },
    ]
    resp = openai_client().chat.completions.create(
        **config["llm"],
        messages=messages,
    )
    return {"answer": resp.choices[0].message.content}


def build_graph():
    graph = StateGraph(State)
    graph.add_node("retrieve", retrieve)
    graph.add_node("generate", generate)
    graph.add_edge(START, "retrieve")
    graph.add_edge("retrieve", "generate")
    graph.add_edge("generate", END)
    return graph.compile()
