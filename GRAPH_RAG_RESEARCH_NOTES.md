# Knowledge graph and RAG research notes

## What the graph represents

The graph is an application data model, not a diagram image and not a claim that the
TEP process is controlled through discrete AI handoffs. Neo4j stores entities as nodes
and named relationships as edges. The local fallback uses the same shape in memory.

Current node groups:

- **Process units:** the benchmark unit arrangement used by the application. Individual
  stream labels and unit mappings still need review against the exact source diagram.
- **Sensors and actuators:** application TEP channels with their code and telemetry
  metadata. The app currently models fewer benchmark channels than the candidate CSV
  schema; the graph page lists the missing and extra tags.
- **Fault labels:** benchmark labels with citation/status metadata. IDV 1–20 point to a
  published fault-catalog candidate; IDV 21 is app-defined and is explicitly not
  supported by that citation.

Edges such as `ASSOCIATED_WITH` and `AFFECTS_UNIT` support investigation and impact
review. They are marked as unverified mappings where appropriate. They do not mean
causality, confirmed propagation, or a maintenance procedure. The old generated symptom
thresholds and placeholder SOP nodes are no longer seeded; startup marks app-owned legacy
entities as deprecated and excludes them from active graph reads without deleting them.

## What the RAG search represents

The corpus now has three source-traceable entries: the original TEP process-control
paper, the Rieth et al. dataset record, and a published TEP fault catalog. Retrieval
uses a precomputed BM25-style lexical index plus explicit IDV/entity matches. Index
statistics are computed once at startup, so each search ranks the small corpus without
rebuilding document frequency. The displayed score is normalized within that query; it
is only a ranking value, not confidence or answer quality.

This is a useful, auditable research search but not a complete engineering RAG system:
it has no site SOP corpus, no vector embeddings or semantic search, and no retrieval/answer
evaluation set. An exact citation and the claim's evidence status are shown with each
result and carried into downloads and ticket references.

## Data provenance and evidence status

The local CSV schema is compatible with a commonly used TEP release, but matching column
names alone does not establish the origin, version, or license. Record the original
download URL and dataset version and compare file checksums with a known deposit before
citing the local files as that release. The Harvard Dataverse DOI below is a candidate
source, not an asserted match.

| Evidence | How it is used | Source |
| --- | --- | --- |
| Primary TEP benchmark paper | Process scope and broad arrangement | [Downs & Vogel (1993), DOI 10.1016/0098-1354(93)80018-i](https://doi.org/10.1016/0098-1354(93)80018-i) |
| Dataset deposit metadata | Candidate dataset provenance | [Rieth et al. (2017), Harvard Dataverse, DOI 10.7910/DVN/6C3JR1](https://doi.org/10.7910/DVN/6C3JR1) |
| Published fault catalog | Descriptions for IDV 1–20; 16–20 are listed as unknown in this source | [Zhang, Luo & Dai (2021), DOI 10.3390/s21030822](https://doi.org/10.3390/s21030822) |

None of these sources is a plant's current operating procedure, alarm threshold, or
maintenance instruction. Add those only from controlled, site-approved documents with
revision, section/page, owner, and review date captured as metadata.

## Next research-grade improvement

Before adding vector or graph-expanded RAG, assemble a small reviewed question set with
the expected source passage for each query. Measure retrieval quality (for example,
precision at k and reciprocal rank) and manually review unsupported claims. Once the
corpus is larger, compare lexical retrieval against hybrid lexical/vector retrieval on
that same set. This demonstrates whether the added complexity improves retrieval rather
than assuming embeddings or Neo4j automatically make search better.

For generated answers, separately evaluate source faithfulness and answer relevance;
RAGAS describes these as different RAG quality dimensions ([Es et al. (2023)](https://arxiv.org/abs/2309.15217)). An LLM evaluator is a measurement aid, not a substitute for expert review of safety-related content.
