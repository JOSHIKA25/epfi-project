/**
 * Source-traceable TEP research corpus.
 *
 * This corpus contains benchmark, dataset, fault-catalog, and related-work references.
 * It does not contain approved site SOPs, safety limits, or operating instructions.
 * Search is a small in-process BM25-style lexical/entity index; it is not semantic
 * or vector retrieval, and scores are ranking signals rather than probabilities.
 */

export type EvidenceStatus = 'PRIMARY_SOURCE' | 'METADATA_VERIFIED' | 'SECONDARY_SOURCE';

export interface RAGDocumentChunk {
  id: string;
  documentTitle: string;
  section: string;
  category: 'process_spec' | 'fault_physics' | 'research_method' | 'maintenance_sop' | 'safety_limits' | 'instrumentation';
  content: string;
  keywords: string[];
  applicableFaults?: number[];
  applicableSensors?: string[];
  source: {
    citation: string;
    url: string;
    verificationStatus: EvidenceStatus;
    note: string;
  };
}

export interface RAGSearchResult {
  chunk: RAGDocumentChunk;
  score: number;
  matchedKeywords: string[];
  evidenceStatus: EvidenceStatus;
  retrievalMethod: 'BM25_LEXICAL_ENTITY';
}

export const TEP_RAG_CORPUS: RAGDocumentChunk[] = [
  {
    id: 'SRC-TEP-1993',
    documentTitle: 'A Plant-Wide Industrial Process Control Problem',
    section: 'Benchmark scope and process arrangement',
    category: 'process_spec',
    content: 'Downs and Vogel introduced the Tennessee Eastman process as a model industrial chemical process for developing, studying, and evaluating process-control technology. Their paper describes a reactor, separator, and recycle arrangement, two simultaneous gas-liquid exothermic reactions, 12 manipulated valves, and 41 measurements. This source supports benchmark context; it is not a site operating manual and does not provide approved safety limits or maintenance procedures.',
    keywords: ['tennessee eastman', 'tep', 'benchmark', 'process control', 'reactor', 'separator', 'recycle', 'measurements', 'valves'],
    source: {
      citation: 'Downs, J. J. & Vogel, E. F. (1993). A Plant-Wide Industrial Process Control Problem. Computers & Chemical Engineering, 17(3), 245–255. DOI: 10.1016/0098-1354(93)80018-i.',
      url: 'https://doi.org/10.1016/0098-1354(93)80018-i',
      verificationStatus: 'PRIMARY_SOURCE',
      note: 'Bibliographic details and abstract verified against the publisher record; consult the full paper for detailed claims.',
    },
  },
  {
    id: 'SRC-TEP-RIETH-2017',
    documentTitle: 'Additional Tennessee Eastman Process Simulation Data for Anomaly Detection Evaluation',
    section: 'Dataset record and local-file provenance',
    category: 'process_spec',
    content: 'Harvard Dataverse records the Rieth, Amsel, Tran, and Cook TEP simulation dataset (Version 1.0; DOI 10.7910/DVN/6C3JR1), with fault-free and faulty training/testing files. The record describes 55 columns: faultNumber, simulationRun, sample, and 52 process variables. Faulty data in this release covers fault numbers 1-20; simulationRun identifies a generated run, samples are taken every three minutes, and fault onset differs between training and test sets. This project has local CSV files with a schema compatible with this record, but matching columns alone does not prove file provenance. Verify local files by recorded download/version or checksums before claiming they came from this deposit.',
    keywords: ['rieth', 'amsel', 'tran', 'cook', 'dataverse', 'dataset', 'provenance', 'faultnumber', 'simulationrun', 'sample', 'xmeas', 'xmv', 'license', 'run split', 'fault onset'],
    source: {
      citation: 'Rieth, C. A., Amsel, B. D., Tran, R., & Cook, M. B. (2017). Additional Tennessee Eastman Process Simulation Data for Anomaly Detection Evaluation, Version 1.0. Harvard Dataverse. DOI: 10.7910/DVN/6C3JR1.',
      url: 'https://doi.org/10.7910/DVN/6C3JR1',
      verificationStatus: 'METADATA_VERIFIED',
      note: 'Deposit metadata is verified as a candidate source. The local CSV files have not been matched by hash or download history; confirm the dataset license from the deposit record.',
    },
  },
  {
    id: 'SRC-TEP-FAULT-CATALOG',
    documentTitle: 'Published Tennessee Eastman benchmark fault catalog',
    section: 'Fault IDs and disturbance classes',
    category: 'fault_physics',
    content: 'A published TEP fault-diagnosis study lists IDV 1–15 as known benchmark disturbances: step changes include feed composition/ratio, feed or cooling-water temperatures, feed loss, and header pressure; random disturbances include feed composition/temperature and cooling-water temperatures; IDV 13 is reaction-kinetics drift; IDV 14 and 15 are sticking reactor and condenser cooling-water valves. IDV 16–20 are listed as unknown fault types in that source. This is a published benchmark fault catalog, not a real-plant diagnosis or maintenance recommendation. Check the local dataset release separately before assuming its label set is identical.',
    keywords: ['fault', 'faults', 'fault catalog', 'idv', 'step', 'random', 'drift', 'sticking', 'unknown', 'valve', 'cooling water', 'feed composition'],
    applicableFaults: Array.from({ length: 20 }, (_, index) => index + 1),
    source: {
      citation: 'Zhang, J., Luo, W., & Dai, Y. (2021). Integrated Diagnostic Framework for Process and Sensor Faults in Chemical Industry. Sensors, 21(3), 822. DOI: 10.3390/s21030822.',
      url: 'https://doi.org/10.3390/s21030822',
      verificationStatus: 'SECONDARY_SOURCE',
      note: 'Secondary published source for the fault table. It lists IDV 16–20 as unknown; do not infer a specific physical cause for those labels.',
    },
  },
  {
    id: 'SRC-TEP-FAULTEXPLAINER-2025',
    documentTitle: 'FaultExplainer: Leveraging Large Language Models for Interpretable Fault Detection and Diagnosis',
    section: 'TEP PCA, contribution analysis, retrieved process knowledge, and LLM explanation',
    category: 'research_method',
    content: 'FaultExplainer is an interactive TEP fault explanation system. It uses PCA-based fault detection and identifies contributing variables, then gives quantitative results and process documentation to an LLM to produce explanations. The authors evaluated GPT-4o and o1 in cases with and without known historical root causes. Their reported limitations include dependence on selected PCA features and occasional hallucinations. This is prior research, not an approved operating procedure or proof that an LLM explanation is a verified physical cause.',
    keywords: ['faultexplainer', 'rag', 'retrieval augmented generation', 'llm', 'large language model', 'pca', 'contribution', 'root cause', 'gpt-4o', 'o1', 'prior work', 'literature'],
    source: {
      citation: 'Khan, A., Nahar, R., Chen, H., Constante Flores, G. E., & Li, C. (2025). FaultExplainer: Leveraging Large Language Models for Interpretable Fault Detection and Diagnosis. Computers & Chemical Engineering. DOI: 10.1016/j.compchemeng.2025.109152.',
      url: 'https://www.sciencedirect.com/science/article/pii/S0098135425001565',
      verificationStatus: 'PRIMARY_SOURCE',
      note: 'Publisher article and authors’ presentation describe the TEP system and evaluation. Use as related work; do not treat its generated explanations as ground truth procedures.',
    },
  },
  {
    id: 'SRC-TEP-KDACL-2026',
    documentTitle: 'KDACL: Knowledge-Data Fusion for Interpretable Anomaly Causal Chain Construction',
    section: 'Retrieved mechanisms checked against process sensor data',
    category: 'research_method',
    content: 'KDACL is a process-industry research method combining an LLM, retrieval-augmented generation, and sensor-data consistency checks. It retrieves mechanistic knowledge as context for candidate explanations, then checks candidate causal hypotheses against temporal sensor behavior and revises the proposed causal chain. The paper reports evaluation on the Tennessee Eastman Process and a real slag-mill system. This describes a research method, not a verified causal map or operating procedure for this application.',
    keywords: ['kdacl', 'rag', 'retrieval augmented generation', 'mechanistic knowledge', 'causal chain', 'sensor consistency', 'root cause', 'llm', 'prior work', 'literature', 'tep'],
    source: {
      citation: 'Yang, T., Zhu, M., Ji, Y., Li, Q., & Chen, B. (2026). KDACL: A knowledge-data fusion-driven method for interpretable anomaly causal chain construction in process industries using large language models. Journal of Intelligent Manufacturing. DOI: 10.1007/s10845-026-02830-6.',
      url: 'https://doi.org/10.1007/s10845-026-02830-6',
      verificationStatus: 'PRIMARY_SOURCE',
      note: 'Publisher DOI record identifies the article; consult its full text and experimental setup before reproducing its reported results.',
    },
  },
  {
    id: 'SRC-TEP-AICHE-MULTIAGENT-2025',
    documentTitle: 'A Multi-Agent Framework for Enhanced Chemical Process Fault Diagnosis',
    section: 'AIChE 2025 conference proceeding: TEP, agent workflow, and RAG',
    category: 'research_method',
    content: 'This AIChE 2025 conference proceeding describes a chemical-process fault-diagnosis workflow using agents to collect process data, diagnose, visualize, and produce an LLM summary. Its RAG component retrieves historical cases and documented remedies as context. The proceeding includes a Tennessee Eastman case study. Treat this as a reported framework and case study, not as evidence that the retrieved remedies are validated for this project or for a real plant.',
    keywords: ['aiche', 'conference', 'multi-agent', 'rag', 'retrieval augmented generation', 'historical cases', 'remedies', 'tep', 'fault diagnosis', 'visualization', 'prior work', 'literature'],
    source: {
      citation: 'Liang, J. & Sin, G. (2025). A Multi-Agent Framework for Enhanced Chemical Process Fault Diagnosis: Integrating Intelligent Analysis, Visualization, and User-Centric Decision Support. AIChE Annual Meeting 2025 Proceedings.',
      url: 'https://proceedings.aiche.org/conferences/aiche-annual-meeting/2025/proceeding/paper/multi-agent-framework-enhanced',
      verificationStatus: 'PRIMARY_SOURCE',
      note: 'Conference proceeding entry; distinguish it from a full peer-reviewed journal article when discussing evidence strength.',
    },
  },
];

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'from', 'what', 'which', 'when', 'where', 'does', 'this', 'that', 'are', 'was', 'how', 'can', 'could', 'into', 'about', 'tell', 'show', 'give', 'please']);
const tokenize = (text: string): string[] => text.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 1 && !STOP_WORDS.has(token));

interface IndexedChunk {
  chunk: RAGDocumentChunk;
  terms: string[];
  termFrequency: Map<string, number>;
  length: number;
  titleTerms: Set<string>;
  keywordTerms: Set<string>;
}

const INDEX: IndexedChunk[] = TEP_RAG_CORPUS.map((chunk) => {
  const terms = tokenize(`${chunk.documentTitle} ${chunk.section} ${chunk.content} ${chunk.keywords.join(' ')}`);
  const termFrequency = new Map<string, number>();
  for (const term of terms) termFrequency.set(term, (termFrequency.get(term) || 0) + 1);
  return {
    chunk,
    terms,
    termFrequency,
    length: terms.length,
    titleTerms: new Set(tokenize(chunk.documentTitle)),
    keywordTerms: new Set(tokenize(chunk.keywords.join(' '))),
  };
});
const AVERAGE_LENGTH = INDEX.reduce((sum, doc) => sum + doc.length, 0) / Math.max(1, INDEX.length);
const DOCUMENT_FREQUENCY = new Map<string, number>();
for (const document of INDEX) {
  for (const term of document.termFrequency.keys()) DOCUMENT_FREQUENCY.set(term, (DOCUMENT_FREQUENCY.get(term) || 0) + 1);
}

export class TEPRagEngine {
  public search(query: string, limit = 4): RAGSearchResult[] {
    const normalizedQuery = query.toLowerCase();
    const queryTerms = Array.from(new Set(tokenize(query)));
    if (!queryTerms.length) return [];

    const faultMatch = normalizedQuery.match(/\bidv\s*[-(]?\s*(\d+)\)?/);
    const sensorMatches = Array.from(normalizedQuery.matchAll(/\b(xmeas|xmv)[_\s(]*([0-9]{1,2})\)?/g));
    const scored = INDEX.map((document) => {
      let score = 0;
      const matchedKeywords: string[] = [];
      for (const term of queryTerms) {
        const tf = document.termFrequency.get(term) || 0;
        if (!tf) continue;
        const df = DOCUMENT_FREQUENCY.get(term) || 0;
        const idf = Math.log(1 + (INDEX.length - df + 0.5) / (df + 0.5));
        const k1 = 1.2;
        const b = 0.75;
        const bm25 = idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * document.length / Math.max(1, AVERAGE_LENGTH))));
        score += bm25 * (document.titleTerms.has(term) ? 2.5 : document.keywordTerms.has(term) ? 1.5 : 1);
        matchedKeywords.push(term);
      }
      if (faultMatch && document.chunk.applicableFaults?.includes(Number(faultMatch[1]))) {
        score += 2;
        matchedKeywords.push(`IDV(${faultMatch[1]})`);
      }
      for (const [, kind, number] of sensorMatches) {
        const tag = `${kind.toUpperCase()}_${number}`;
        if (document.chunk.applicableSensors?.includes(tag)) {
          score += 2;
          matchedKeywords.push(`${kind.toUpperCase()}(${number})`);
        }
      }
      return { document, score, matchedKeywords: Array.from(new Set(matchedKeywords)) };
    });

    const maxScore = Math.max(1, ...scored.map((item) => item.score));
    return scored.filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.document.chunk.id.localeCompare(b.document.chunk.id))
      .slice(0, Math.max(1, Math.min(20, limit)))
      .map(({ document, score, matchedKeywords }) => ({
        chunk: document.chunk,
        score: Number((score / maxScore).toFixed(3)),
        matchedKeywords,
        evidenceStatus: document.chunk.source.verificationStatus,
        retrievalMethod: 'BM25_LEXICAL_ENTITY' as const,
      }));
  }
}

export const tepRagEngine = new TEPRagEngine();
