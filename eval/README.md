# Contexta RAG Evaluation & QA Test Harness

This directory contains the reproducible retrieval and answer-quality evaluation harness for Contexta, fulfilling plan requirements (sections 14.10, 19, and 20.5).

## Directory Structure

- `documents/`: Synthetic and curated evaluation documents representing diverse technical, legal, and operational genres:
  - `ml-primer.txt`: Academic paper / primer covering ML theory, neural network architectures, optimization, metrics, and RAG concepts.
  - `privacy-security-policy.txt`: Legal and compliance policy covering data classification, AES-256-GCM encryption, retention lifecycles, BYOK terms, and user rights.
  - `operations-manual.txt`: Systems engineering runbook covering deployment topology, environment variables, job queue management, and incident recovery.
  - `product-specification.txt`: Architecture specification covering quotas, file limits, scanned PDF rejection, HNSW vector indexing, and the SSE streaming protocol.
- `questions.json`: Comprehensive evaluation dataset comprising 68 questions across 4 documents (17 questions per document), including answerable, unanswerable, multi-part, and multi-turn follow-up queries with expected passages, page numbers, and reference answers.
- `summary-checks.json`: Document summary evaluation checklist defining 5–8 required factual propositions and 2–3 forbidden hallucinations per document.
- `run-eval.ts`: Fully automated, reproducible RAG evaluation script.
- `results.md`: Auto-generated evaluation report recording metrics, comparisons, and granular test outcomes.

## Metrics Measured

1. **Retrieval Hit Rate@k ($k=5, 8$)**: Fraction of answerable questions where the expected passage appears in the top-$k$ retrieved chunks. Evaluated for both **Vector-Only** and **Hybrid (Reciprocal Rank Fusion)** modes.
2. **Mean Reciprocal Rank (MRR)**: Average reciprocal rank ($1 / \text{rank}$) of the first relevant passage retrieved.
3. **Page Match Rate**: Accuracy of mapping retrieved chunks to their exact source page number.
4. **Citation Correctness**: Verification that responses cite sources via `[n]` markers mapping to `{ n, documentId, fileName, page, snippet }`.
5. **Unanswerable Refusal Accuracy**: Ensures questions lacking source support trigger unambiguous refusal instructions ("I couldn't find this information in your documents").
6. **Latency & Token Efficiency**: Time to First Token (TTFT) and token consumption metrics during streamed LLM responses.
7. **Summary Quality**: Coverage score (% of required facts captured) and faithfulness score (% of forbidden hallucinations avoided).

## Running the Evaluation

Execute the evaluation script via `tsx`:

```bash
npx tsx eval/run-eval.ts
```

The script evaluates all 68 questions against the document corpus and updates `eval/results.md`.

## Key Findings: Vector-Only vs. Hybrid (RRF)

- **Vector-Only Hit@8**: 32.1% (MRR: 0.130)
- **Hybrid (RRF) Hit@8**: 69.6% (MRR: 0.307)
- **Takeaway**: Hybrid search (combining dense vector similarity with BM25 full-text keyword search via Reciprocal Rank Fusion) delivers a +37.5% lift in top-8 retrieval accuracy. This confirms the architectural decision in plan section 19.6: exact technical terms, error codes, and configuration flags are frequently missed by semantic embeddings alone.

## Private Documents Policy

In adherence to Contexta security rules, private evaluation documents must **never** be committed to the public repository. Place confidential files in `eval/private/` (enforced via `.gitignore`).
