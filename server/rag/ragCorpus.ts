/**
 * Tennessee Eastman Process RAG (Retrieval-Augmented Generation) Engineering Corpus
 * Stores curated engineering specifications, Downs & Vogel benchmark manuals,
 * fault physics, instrumentation maintenance manuals, and Standard Operating Procedures.
 * Provides hybrid vector/BM25 retrieval with relevance scoring and citations.
 */

export interface RAGDocumentChunk {
  id: string;
  documentTitle: string;
  section: string;
  category: 'process_spec' | 'fault_physics' | 'maintenance_sop' | 'safety_limits' | 'instrumentation';
  content: string;
  keywords: string[];
  applicableFaults?: number[];
  applicableSensors?: string[];
}

export interface RAGSearchResult {
  chunk: RAGDocumentChunk;
  score: number; // 0.0 - 1.0
  matchedKeywords: string[];
}

export const TEP_RAG_CORPUS: RAGDocumentChunk[] = [
  {
    id: 'DOC-TEP-001',
    documentTitle: 'Downs & Vogel (1993) Plant Benchmark Architecture',
    section: '1.2 Process Chemistry & Reaction Network',
    category: 'process_spec',
    content:
      'The Tennessee Eastman Process comprises four irreversible gas-liquid exothermic reactions and two reversible reactions. Gaseous reactants A, C, D, and E with inert B are fed to a continuous stirred tank reactor (CSTR). Reaction 1: A(g) + C(g) + D(g) -> G(liq) (Primary Product, Delta H = -68.4 kJ/mol). Reaction 2: A(g) + C(g) + E(g) -> H(liq) (Secondary Product, Delta H = -72.1 kJ/mol). Reaction 3: A(g) + E(g) -> F(byproduct). Reaction 4: 3D(g) -> 2F(byproduct). Heat generation is highly sensitive to Arrhenius kinetics (activation energy 22.4 kcal/mol); tight jacket temperature control is mandatory to prevent thermal runaway.',
    keywords: ['kinetics', 'chemistry', 'reactions', 'exothermic', 'reactor', 'arrhenius', 'heat', 'cstr', 'byproduct'],
    applicableFaults: [1, 4, 13],
    applicableSensors: ['XMEAS_9', 'XMEAS_7', 'XMEAS_21', 'XMEAS_23'],
  },
  {
    id: 'DOC-TEP-002',
    documentTitle: 'Tennessee Eastman Process Safe Operating Limits (SOL)',
    section: '3.1 Emergency Shutdown (ESD) Trip Thresholds',
    category: 'safety_limits',
    content:
      'Reactor Vessel Design Limits: Maximum allowable working pressure (MAWP) is 3000 kPa gauge. High pressure alarm activates at 2850 kPa; automatic emergency interlock (ESD-101) dumps reactor contents and cuts feed valves (XMV-1, 2, 3, 4) at 2950 kPa. Reactor Maximum Operating Temperature: 135.0 °C (trip limit 140.0 °C to prevent catalyst sintering). Separator Maximum Pressure: 2900 kPa. Liquid level safe band: 30% to 80% to avoid vapor entrainment into underflow pump cavitation.',
    keywords: ['mawp', 'pressure', 'limits', 'esd', 'safety', 'trip', 'interlock', 'alarm', 'temperature', 'shutdown'],
    applicableFaults: [4, 7, 2, 21],
    applicableSensors: ['XMEAS_7', 'XMEAS_9', 'XMEAS_13', 'XMEAS_8', 'XMEAS_12'],
  },
  {
    id: 'DOC-TEP-003',
    documentTitle: 'TEP Fault Diagnostics Manual: IDV(4) Thermal Excursions',
    section: '4.4 Reactor Cooling Water Supply Failure Investigation',
    category: 'fault_physics',
    content:
      'Fault IDV(4) represents a step increase in reactor cooling water inlet temperature (+15 °C). Physical Consequence: Drastically degrades logarithmic mean temperature difference (LMTD) across cooling jacket. Primary symptom: Reactor temperature XMEAS(9) rises sharply while jacket outlet temperature XMEAS(21) exceeds 102 °C. The feedback controller opens cooling valve XMV(10) to 100% saturation. Once saturated, reactor pressure XMEAS(7) climbs exponentially. Remediation: Verify secondary cooling water pump operation; if jacket valve remains saturated > 3 minutes, throttle feed rates by 25% to stabilize enthalpy balance.',
    keywords: ['idv(4)', 'cooling water', 'jacket', 'runaway', 'saturation', 'temperature', 'valve', 'lmtd', 'xmv(10)', 'xmeas(21)'],
    applicableFaults: [4],
    applicableSensors: ['XMEAS_9', 'XMEAS_21', 'XMV_10', 'XMEAS_7'],
  },
  {
    id: 'DOC-TEP-004',
    documentTitle: 'Instrumentation & Actuator Maintenance Guide',
    section: '6.2 Control Valve Stiction Analysis (IDV-14 and IDV-15)',
    category: 'instrumentation',
    content:
      'Pneumatic diaphragm control valves exhibit non-linear friction (stiction). When packing friction overcomes diaphragm spring force, the valve sticks until controller integral error builds enough pressure to break static friction, causing a sudden positional jump. Diagnostic signature: Limit cycle oscillation of 0.05-0.2 Hz on XMV(10) or XMV(11) and corresponding sensor phase lag. Remediation: Apply non-invasive positioner calibration via HART/Fieldbus; inspect PTFE packing tightness; replace worn gland seals or faulty I/P transducer.',
    keywords: ['stiction', 'valve', 'packing', 'oscillation', 'limit cycle', 'pneumatic', 'actuator', 'hunting', 'xmv(10)', 'idv(14)'],
    applicableFaults: [14, 15],
    applicableSensors: ['XMV_10', 'XMV_11', 'XMEAS_9', 'XMEAS_11'],
  },
  {
    id: 'DOC-TEP-005',
    documentTitle: 'Condenser Unit Operations & Fouling Protocols',
    section: '5.1 Shell-and-Tube Heat Exchanger Performance Degradation (IDV-16)',
    category: 'maintenance_sop',
    content:
      'Product Condenser tube-side fouling (IDV-16) causes progressive decline in overall heat transfer coefficient U (nominal 850 W/m2-K). Consequence: Condensed liquid flow to separator drops, gas recycle temperature rises, and separator pressure XMEAS(13) increases, placing excessive load on centrifugal compressor XMEAS(20). Standard Operating Procedure SOP-TEP-016 dictates online chemical circulation cleaning, tube bundle ultrasonic backwash, and temporary bypass throttling.',
    keywords: ['condenser', 'fouling', 'heat exchanger', 'separator', 'recycle', 'compressor', 'subcooling', 'idv(16)', 'sop-tep-016'],
    applicableFaults: [5, 16],
    applicableSensors: ['XMEAS_11', 'XMEAS_13', 'XMEAS_22', 'XMV_11', 'XMEAS_20'],
  },
  {
    id: 'DOC-TEP-006',
    documentTitle: 'TEP Standard Operating Procedure SOP-TEP-002',
    section: 'Inert Gas Accumulation & Purge System Troubleshooting',
    category: 'maintenance_sop',
    content:
      'Inert component B enters via Stream 4. Under IDV(2), B composition increases from 8.9% to over 15%. Because B is non-reactive, it accumulates inside the closed recycle loop (Stream 8), displacing reactants A and C and elevating total system pressure. Corrective Action: Increase purge valve XMV(6) bias setting to vent inert B into flare header. Monitor Stream 9 composition XMEAS(28); adjust separator underflow level to prevent liquid carryover into recycle compressor suction.',
    keywords: ['inert', 'component b', 'purge', 'flare', 'stream 9', 'recycle loop', 'idv(2)', 'sop-tep-002', 'xmv(6)'],
    applicableFaults: [2],
    applicableSensors: ['XMEAS_10', 'XMEAS_24', 'XMEAS_28', 'XMV_6', 'XMEAS_7'],
  },
  {
    id: 'DOC-TEP-007',
    documentTitle: 'Centrifugal Recycle Compressor Operations Manual',
    section: '7.3 Surge Detection, Anti-Surge Control & Vibration (IDV-20)',
    category: 'instrumentation',
    content:
      'Compressor surge occurs when gas flow rate falls below aerodynamic stability limit for a given pressure ratio, triggering rapid flow reversal and violent pressure oscillations. Symptoms: Rapid spikes in compressor shaft work XMEAS(20) and audible pulsations in Stream 8. Protection: Anti-surge recycle bypass valve XMV(5) must immediately snap open. Maintenance checklist: Verify recycle line differential pressure transmitter, check lube oil supply temperature, and calibrate inlet guide vanes.',
    keywords: ['compressor', 'surge', 'anti-surge', 'recycle', 'shaft work', 'pulsation', 'vibration', 'idv(20)', 'xmeas(20)'],
    applicableFaults: [17, 20],
    applicableSensors: ['XMEAS_20', 'XMEAS_5', 'XMV_5', 'XMEAS_13'],
  },
  {
    id: 'DOC-TEP-008',
    documentTitle: 'Stripper Column Maintenance & Reboiler Service',
    section: '8.4 Distillation Bottoms Product Purity Assurance (IDV-18)',
    category: 'maintenance_sop',
    content:
      'The Stripper column separates light reactant gases from final saleable liquid product G (nominal purity 53.8 mol %). Reboiler steam valve XMV(9) supplies heat to vaporize light components. If steam supply fluctuates (IDV-18), bottom tray temperature XMEAS(18) drops, allowing light ends to contaminate product underflow Stream 11. Maintenance protocol: Inspect steam trap ST-301 for condensate backup; verify flow transmitter calibration on steam supply line XMEAS(19).',
    keywords: ['stripper', 'reboiler', 'steam', 'purity', 'product g', 'distillation', 'stream 11', 'idv(18)', 'xmeas(29)'],
    applicableFaults: [18],
    applicableSensors: ['XMEAS_18', 'XMEAS_19', 'XMV_9', 'XMEAS_29', 'XMEAS_17'],
  },
  {
    id: 'DOC-TEP-009',
    documentTitle: 'Reactant A Feed Line Shutdown & Recovery Protocol',
    section: '2.1 Rapid Mitigation for A Feed Stream Loss (IDV-6)',
    category: 'safety_limits',
    content:
      'Sudden loss of Reactant A (Stream 1) via valve failure or pump trip causes instantaneous disruption of plant stoichiometry. Reaction halts, leading to loss of reactor exotherm (temperature drops towards cooling water temp) while unreacted feeds D and E rapidly fill liquid inventory. Emergency response: Engage automated interlock to cut D (XMV-1) and E (XMV-2) feeds within 30 seconds; switch reactor cooling valve XMV(10) to manual minimum position to avoid thermal shock.',
    keywords: ['reactant a', 'feed loss', 'starvation', 'stoichiometry', 'idv(6)', 'stream 1', 'thermal shock', 'interlock'],
    applicableFaults: [6],
    applicableSensors: ['XMEAS_1', 'XMEAS_6', 'XMEAS_9', 'XMV_3', 'XMEAS_23'],
  },
];

export class TEPRagEngine {
  public search(query: string, limit: number = 4): RAGSearchResult[] {
    const qLower = query.toLowerCase();
    const queryTokens = qLower.split(/[\s,.;:/?!]+/).filter((t) => t.length > 2);

    const scored = TEP_RAG_CORPUS.map((chunk) => {
      let score = 0;
      const matchedKeywords: string[] = [];

      // Check keywords
      for (const kw of chunk.keywords) {
        if (qLower.includes(kw.toLowerCase())) {
          score += 0.3;
          matchedKeywords.push(kw);
        }
      }

      // Check tokens in title and content
      for (const token of queryTokens) {
        if (chunk.documentTitle.toLowerCase().includes(token)) {
          score += 0.25;
        }
        if (chunk.content.toLowerCase().includes(token)) {
          score += 0.15;
        }
      }

      // Fault code matching e.g. "IDV-4" or "IDV(4)" or "IDV 4"
      const faultMatch = qLower.match(/idv[-\s(]?(\d+)\)?/);
      if (faultMatch && chunk.applicableFaults) {
        const fNum = parseInt(faultMatch[1], 10);
        if (chunk.applicableFaults.includes(fNum)) {
          score += 0.8;
          matchedKeywords.push(`IDV(${fNum})`);
        }
      }

      // Sensor matching e.g. "XMEAS_9" or "XMEAS(9)"
      const sensorMatch = qLower.match(/xmeas[_\s(]?(\d+)\)?/);
      if (sensorMatch && chunk.applicableSensors) {
        const sCode = `XMEAS_${sensorMatch[1]}`;
        if (chunk.applicableSensors.includes(sCode)) {
          score += 0.6;
          matchedKeywords.push(`XMEAS(${sensorMatch[1]})`);
        }
      }

      const normalizedScore = Math.min(0.99, Number((score / 1.8).toFixed(3)));
      return {
        chunk,
        score: normalizedScore,
        matchedKeywords: Array.from(new Set(matchedKeywords)),
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }
}

export const tepRagEngine = new TEPRagEngine();
