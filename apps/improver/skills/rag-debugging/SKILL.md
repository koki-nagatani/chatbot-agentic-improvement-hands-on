---
name: rag-debugging
description: Diagnose why the RAG chatbot gave a bad answer by isolating the failing layer (retrieval, grounding, instruction, conversation context, knowledge gap, graph architecture). Use before changing anything in response to a reported answer problem.
---

# RAG debugging

The goal is to find the **layer** that caused the bad answer, then change that layer.
Editing the prompt is not the default fix. A longer prompt cannot fix a retrieval miss.

## 1. Reproduce and collect evidence

If the user shared a chat URL or session id, load it with `load_chat_session` first. The traces
show exactly what the user saw: the search query, retrieved documents, and answer of each turn.

Ask the chatbot the reported question with `ask_chatbot`. Pass `history` when the problem
involves a follow-up question. From the trace, note:

- `search_query`: what was actually searched
- `retrieved_documents`: ids, scores, and whether the text contains the needed facts
- `answer`: which claims are supported by the retrieved text and which are not

Then check whether the needed fact exists in the knowledge at all:
`search_files` over `apps/chatbot/knowledge` with a few keywords and synonyms.

## 2. Classify the failure

Work through these questions in order. The first "yes" is usually the root cause.

| Question | Failure type | Typical layer to change |
| --- | --- | --- |
| Does the knowledge lack the needed fact? | Knowledge gap | Answer behavior for unknowns (don't guess). Add knowledge only if the fact is truly public and verified. |
| Is the question a follow-up, and does `search_query` lack the context it refers to? | Conversation context failure | A query rewrite node that turns the follow-up into a standalone question using history. Avoid pasting raw history (especially long assistant answers) into the search query. |
| Is the fact in the knowledge but missing from `retrieved_documents`? | Retrieval failure | `top_k`, chunking, query rewrite or multi-query, hybrid/keyword search, metadata |
| Is the fact retrieved, but the answer contradicts it or adds unsupported claims? | Grounding failure | Grounding instructions, relevance check, refusal when evidence is insufficient |
| Is the content right but the style wrong (too long, lists unrequested features)? | Instruction / format failure | Answer style instructions in prompts |
| Does a fix need a step the 2-node graph cannot express (rewrite, check, route)? | Graph architecture limitation | Add nodes or edges in `graph.py` |

Several failures can stack. For example, a follow-up can miss retrieval (context failure) and then
the model guesses (grounding failure). Fix the upstream cause first.

## 3. Choose the change

- Prefer the smallest change at the right layer.
- When retrieval is the problem, verify the fix with `ask_chatbot` before running the full eval.
  Check that the needed chunk now appears in `retrieved_documents`.
- After changing chunking, the embedding model, `ingest.py`, or knowledge files, run `rebuild_index`.
- Keep the bot's runtime path free of anything except the chatbot itself. Do not call the
  improvement tooling from the bot.

## 4. Explain the diagnosis

When reporting to the user, use this chain:

```text
Symptom → evidence (trace) → root cause → layer → change
```
