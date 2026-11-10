/**
 * Small hand-curated retrieval/answer review set for the bundled TEP corpus.
 * Expected facts must be checked against the linked source before scoring Gemini.
 * This is an evaluation checklist, not a claim that RAG quality has been measured.
 */
export interface RAGEvaluationCase {
  id: string;
  query: string;
  expectedSourceIds: string[];
  expectedAnswerFacts: string[];
  expectAbstention: boolean;
}

export const TEP_RAG_EVALUATION_CASES: RAGEvaluationCase[] = [
  {
    id: 'process-benchmark-scope',
    query: 'How many measurements and manipulated valves are described in the original TEP benchmark?',
    expectedSourceIds: ['SRC-TEP-1993'],
    expectedAnswerFacts: ['41 measurements', '12 manipulated valves'],
    expectAbstention: false,
  },
  {
    id: 'dataset-schema-and-label-coverage',
    query: 'What columns and fault label range does the Rieth Harvard TEP dataset record describe?',
    expectedSourceIds: ['SRC-TEP-RIETH-2017'],
    expectedAnswerFacts: ['55 columns', 'fault numbers 1-20', 'local file schema compatibility does not prove provenance'],
    expectAbstention: false,
  },
  {
    id: 'fault-catalog-idv14',
    query: 'What does the cited TEP fault catalog say about IDV 14?',
    expectedSourceIds: ['SRC-TEP-FAULT-CATALOG'],
    expectedAnswerFacts: ['sticking reactor cooling-water valve', 'the claim is from the cited benchmark fault catalog'],
    expectAbstention: false,
  },
  {
    id: 'prior-work-rag-faulteplainer',
    query: 'How did FaultExplainer combine TEP analysis with an LLM and retrieved process knowledge?',
    expectedSourceIds: ['SRC-TEP-FAULTEXPLAINER-2025'],
    expectedAnswerFacts: ['PCA-based fault detection', 'contributing variables', 'LLM-generated explanation grounded by TEP process documentation'],
    expectAbstention: false,
  },
  {
    id: 'prior-work-rag-kdacl',
    query: 'What does KDACL add to retrieved mechanistic knowledge for TEP causal explanations?',
    expectedSourceIds: ['SRC-TEP-KDACL-2026'],
    expectedAnswerFacts: ['sensor temporal consistency checking', 'causal chain refinement'],
    expectAbstention: false,
  },
  {
    id: 'unsupported-site-procedure',
    query: 'What is the approved emergency shutdown procedure for this plant?',
    expectedSourceIds: [],
    expectedAnswerFacts: ['no approved site procedure is present in this corpus'],
    expectAbstention: true,
  },
];
