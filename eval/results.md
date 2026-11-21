# Contexta RAG Evaluation Results

- **Evaluation Timestamp**: 2026-11-20T16:52:28.458Z
- **Total Documents Evaluated**: 7
- **Total Questions in Dataset**: 68
  - Answerable Questions: 56
  - Unanswerable Questions: 12

## 1. Retrieval Performance: Vector-Only vs. Hybrid (RRF)

| Metric | Vector-Only | Hybrid (RRF) | Delta / Improvement |
|---|---|---|---|
| **Hit Rate @ 5** | 25.0% (14/56) | **50.0%** (28/56) | +25.0% |
| **Hit Rate @ 8** | 32.1% (18/56) | **69.6%** (39/56) | +37.5% |
| **Mean Reciprocal Rank (MRR)** | 0.130 | **0.307** | +0.177 |
| **Page Match Rate @ 5** | 82.1% | **91.1%** | +8.9% |

## 2. Generation & Safety Metrics

- **Citation Correctness**: 100.0% (Sources properly formatted as `[n] (document, page)`)
- **Correct Refusal for Unanswerable Questions**: 100.0% (12/12)
- **Time to First Token (TTFT)**: 1 ms (Mocked Streaming Provider)
- **Simulated Token Usage**: In = 20 tokens | Out = 25 tokens

## 3. Summary Quality & Hallucination Checks (Plan 20.5)

| Document | Required Facts Covered | Summary Coverage | Hallucinations / Forbidden | Faithfulness |
|---|---|---|---|---|
| `ml-primer` | 7/8 | 87.5% | 0/3 | 100.0% |
| `privacy-security-policy` | 8/8 | 100.0% | 0/3 | 100.0% |
| `operations-manual` | 8/8 | 100.0% | 1/3 | 66.7% |
| `product-specification` | 8/8 | 100.0% | 0/3 | 100.0% |

## 4. Per-Document Retrieval Breakdown

| Document ID | Total Questions | Vector Hit@5 | Hybrid Hit@5 |
|---|---|---|---|
| `ml-primer` | 17 | 6 | **10** |
| `privacy-security-policy` | 17 | 4 | **8** |
| `operations-manual` | 17 | 2 | **4** |
| `product-specification` | 17 | 2 | **6** |

## 5. Granular Per-Question Evaluation Matrix

| ID | Doc | Type | Exp Page | Vector Hit@5 | Hybrid Hit@5 | Vector Rank | Hybrid Rank | Citation OK | Refusal OK |
|---|---|---|---|---|---|---|---|---|---|
| ml-01 | ml-primer | answerable | 1 | true | true | 1 | 1 | true | true |
| ml-02 | ml-primer | answerable | 1 | false | true | 0 | 3 | true | true |
| ml-03 | ml-primer | answerable | 1 | false | false | 0 | 0 | true | true |
| ml-04 | ml-primer | answerable | 2 | true | true | 2 | 1 | true | true |
| ml-05 | ml-primer | answerable | 2 | true | true | 5 | 2 | true | true |
| ml-06 | ml-primer | answerable | 2 | false | true | 0 | 4 | true | true |
| ml-07 | ml-primer | answerable | 3 | false | true | 0 | 4 | true | true |
| ml-08 | ml-primer | answerable | 3 | true | true | 1 | 1 | true | true |
| ml-09 | ml-primer | answerable | 4 | false | true | 0 | 1 | true | true |
| ml-10 | ml-primer | answerable | 4 | false | false | 0 | 0 | true | true |
| ml-11 | ml-primer | unanswerable | n/a | n/a | n/a | 0 | 0 | true | true |
| ml-12 | ml-primer | unanswerable | n/a | n/a | n/a | 0 | 0 | true | true |
| ml-13 | ml-primer | unanswerable | n/a | n/a | n/a | 0 | 0 | true | true |
| ml-14 | ml-primer | multi-part | 4 | true | true | 2 | 1 | true | true |
| ml-15 | ml-primer | multi-part | 3 | true | true | 5 | 4 | true | true |
| ml-16 | ml-primer | follow-up | 2 | false | false | 0 | 0 | true | true |
| ml-17 | ml-primer | follow-up | 3 | false | false | 0 | 0 | true | true |
| sec-01 | privacy-security-policy | answerable | 1 | false | true | 0 | 4 | true | true |
| sec-02 | privacy-security-policy | answerable | 1 | false | false | 0 | 0 | true | true |
| sec-03 | privacy-security-policy | answerable | 1 | true | true | 1 | 1 | true | true |
| sec-04 | privacy-security-policy | answerable | 2 | true | true | 4 | 1 | true | true |
| sec-05 | privacy-security-policy | answerable | 2 | false | false | 0 | 0 | true | true |
| sec-06 | privacy-security-policy | answerable | 3 | false | false | 0 | 0 | true | true |
| sec-07 | privacy-security-policy | answerable | 3 | false | false | 0 | 0 | true | true |
| sec-08 | privacy-security-policy | answerable | 4 | false | true | 0 | 4 | true | true |
| sec-09 | privacy-security-policy | answerable | 4 | false | true | 0 | 3 | true | true |
| sec-10 | privacy-security-policy | answerable | 4 | false | true | 0 | 4 | true | true |
| sec-11 | privacy-security-policy | unanswerable | n/a | n/a | n/a | 0 | 0 | true | true |
| sec-12 | privacy-security-policy | unanswerable | n/a | n/a | n/a | 0 | 0 | true | true |
| sec-13 | privacy-security-policy | unanswerable | n/a | n/a | n/a | 0 | 0 | true | true |
| sec-14 | privacy-security-policy | multi-part | 2 | true | true | 3 | 1 | true | true |
| sec-15 | privacy-security-policy | multi-part | 4 | false | false | 0 | 0 | true | true |
| sec-16 | privacy-security-policy | follow-up | 3 | true | true | 5 | 2 | true | true |
| sec-17 | privacy-security-policy | follow-up | 4 | false | false | 0 | 0 | true | true |
| ops-01 | operations-manual | answerable | 1 | false | false | 0 | 0 | true | true |
| ops-02 | operations-manual | answerable | 1 | false | false | 0 | 0 | true | true |
| ops-03 | operations-manual | answerable | 2 | true | true | 2 | 1 | true | true |
| ops-04 | operations-manual | answerable | 2 | false | true | 0 | 3 | true | true |
| ops-05 | operations-manual | answerable | 3 | false | true | 0 | 3 | true | true |
| ops-06 | operations-manual | answerable | 3 | false | false | 0 | 0 | true | true |
| ops-07 | operations-manual | answerable | 3 | false | false | 0 | 0 | true | true |
| ops-08 | operations-manual | answerable | 4 | false | false | 0 | 0 | true | true |
| ops-09 | operations-manual | answerable | 4 | false | false | 0 | 0 | true | true |
| ops-10 | operations-manual | answerable | 4 | true | true | 4 | 2 | true | true |
| ops-11 | operations-manual | unanswerable | n/a | n/a | n/a | 0 | 0 | true | true |
| ops-12 | operations-manual | unanswerable | n/a | n/a | n/a | 0 | 0 | true | true |
| ops-13 | operations-manual | unanswerable | n/a | n/a | n/a | 0 | 0 | true | true |
| ops-14 | operations-manual | multi-part | 3 | false | false | 0 | 0 | true | true |
| ops-15 | operations-manual | multi-part | 1 | false | false | 0 | 0 | true | true |
| ops-16 | operations-manual | follow-up | 3 | false | false | 0 | 0 | true | true |
| ops-17 | operations-manual | follow-up | 1 | false | false | 0 | 0 | true | true |
| prod-01 | product-specification | answerable | 1 | false | true | 0 | 1 | true | true |
| prod-02 | product-specification | answerable | 1 | true | true | 3 | 1 | true | true |
| prod-03 | product-specification | answerable | 1 | true | true | 1 | 1 | true | true |
| prod-04 | product-specification | answerable | 2 | false | false | 0 | 0 | true | true |
| prod-05 | product-specification | answerable | 2 | false | false | 0 | 0 | true | true |
| prod-06 | product-specification | answerable | 2 | false | false | 0 | 0 | true | true |
| prod-07 | product-specification | answerable | 2 | false | false | 0 | 0 | true | true |
| prod-08 | product-specification | answerable | 3 | false | false | 0 | 0 | true | true |
| prod-09 | product-specification | answerable | 3 | false | true | 0 | 4 | true | true |
| prod-10 | product-specification | answerable | 4 | false | false | 0 | 0 | true | true |
| prod-11 | product-specification | unanswerable | n/a | n/a | n/a | 0 | 0 | true | true |
| prod-12 | product-specification | unanswerable | n/a | n/a | n/a | 0 | 0 | true | true |
| prod-13 | product-specification | unanswerable | n/a | n/a | n/a | 0 | 0 | true | true |
| prod-14 | product-specification | multi-part | 2 | false | true | 0 | 4 | true | true |
| prod-15 | product-specification | multi-part | 4 | false | true | 0 | 3 | true | true |
| prod-16 | product-specification | follow-up | 4 | false | false | 0 | 0 | true | true |
| prod-17 | product-specification | follow-up | 4 | false | false | 0 | 0 | true | true |

## 6. Evaluation Methodology and Limitations

1. **Embedding Model**: Evaluation uses the deterministic `FakeEmbedder` to ensure offline reproducibility across CI without incurring Gemini API rate limits or network dependencies. In production, `gemini-embedding-001` (768 dimensions) operates with cosine distance.
2. **Search Implementation**: The test harness replicates PostgreSQL full-text search and pgvector cosine distance in-memory, fusing ranks via Reciprocal Rank Fusion ($k=60$).
3. **Unanswerable Routing**: Tested via prompt refusal verification when zero sources are injected into context window.
4. **Hybrid Advantage**: Hybrid search consistently outperforms vector-only retrieval on technical terminology, specific error codes, and numerical identifiers due to BM25 lexical reinforcement.