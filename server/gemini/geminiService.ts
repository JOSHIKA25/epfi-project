/**
 * Google Gemini AI Reasoning & Natural Language Interface
 *
 * Behavior:
 * 1. General questions -> normal concise LLM response.
 * 2. TEP / Digital Twin questions -> grounded response using:
 *    - Live telemetry
 *    - Autoencoder anomaly detection
 *    - Unvalidated physics-signature fault score
 *    - Heuristic sensor attribution
 *    - Knowledge Graph
 *    - RAG engineering documentation
 *    - Maintenance work orders
 *
 * Gemini model:
 *    gemini-3.5-flash-lite
 */

import { GoogleGenAI } from '@google/genai';

import { tepSimulator } from '../tep/tepSimulator.ts';
import { autoencoderDetector } from '../ml/autoencoder.ts';
import { physicsSignaturePredictor } from '../ml/physicsSignaturePredictor.ts';
import { shapEngine } from '../ml/shapEngine.ts';
import { tepKnowledgeGraph } from '../kg/neo4jGraph.ts';
import { tepRagEngine } from '../rag/ragCorpus.ts';
import { crewaiOrchestrator } from '../agents/crewaiOrchestrator.ts';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  groundingSources?: {
    type:
      | 'TELEMETRY'
      | 'XAI_SHAP'
      | 'KNOWLEDGE_GRAPH'
      | 'RAG_DOC'
      | 'PREDICTION';
    title: string;
    details: string;
  }[];
}

export class GeminiService {
  private ai: GoogleGenAI | null = null;

  // Working free-tier model
  private readonly modelName = 'gemini-3.5-flash-lite';

  constructor() {
    this.initClient();
  }

  // ============================================================
  // GEMINI CLIENT
  // ============================================================

  private initClient(): void {
    const apiKey = process.env.GEMINI_API_KEY;

    if (apiKey) {
      this.ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
    }
  }

  // ============================================================
  // DETECT WHETHER QUESTION IS RELATED TO OUR TEP SYSTEM
  // ============================================================

  private isTEPQuestion(message: string): boolean {
    const text = message.toLowerCase();

    const keywords = [
      // TEP / Digital Twin
      'tennessee eastman',
      'tennessee eastman process',
      'tep',
      'digital twin',
      'industrial twin',
      'industrial digital twin',
      'plant',

      // Process units
      'reactor',
      'separator',
      'compressor',
      'stripper',
      'condenser',
      'reactor cooling',
      'cooling water',
      'cooling valve',

      // Process variables
      'purge',
      'purge rate',
      'purge valve',
      'feed rate',
      'feed flow',
      'product purity',
      'pressure',
      'reactor pressure',
      'reactor temperature',
      'separator temperature',
      'separator pressure',

      // Sensors / telemetry
      'telemetry',
      'sensor',
      'sensors',
      'xmeas',
      'xmv',
      'process variable',
      'process variables',

      // ML / AI
      'anomaly',
      'anomaly detection',
      'fault',
      'fault detection',
      'failure',
      'failure prediction',
      'prediction',
      'xgboost',
      'autoencoder',
      'shap',
      'explainable ai',
      'xai',
      'model confidence',
      'model agreement',
      'time to failure',
      'ttf',

      // RAG / Knowledge Graph
      'rag',
      'knowledge graph',
      'graph',
      'documentation',
      'engineering document',
      'sop',

      // Maintenance
      'maintenance',
      'maintain',
      'work order',
      'work orders',
      'maintenance action',
      'maintenance recommendation',

      // System health
      'plant health',
      'process health',
      'machine health',
      'system health',
      'current status',
      'plant status',
      'process status',
    ];

    return keywords.some((keyword) => text.includes(keyword));
  }

  // ============================================================
  // DETECT WHETHER USER IS ASKING FOR A DETAILED EXPLANATION
  // ============================================================

  private wantsDetailedAnswer(message: string): boolean {
    const text = message.toLowerCase();

    const detailKeywords = [
      'why',
      'explain',
      'explanation',
      'analyze',
      'analysis',
      'analyse',
      'diagnose',
      'diagnosis',
      'detailed',
      'in detail',
      'how does',
      'how do',
      'what caused',
      'root cause',
      'reason',
      'compare',
      'step by step',
      'steps',
    ];

    return detailKeywords.some((keyword) => text.includes(keyword));
  }

  // ============================================================
  // GENERAL LLM QUESTION
  // ============================================================

  private async chatGeneralQuestion(
    userMessage: string,
    conversationHistory: ChatMessage[],
  ): Promise<ChatMessage> {
    const detailed = this.wantsDetailedAnswer(userMessage);

    const systemPrompt = `
You are a helpful, intelligent AI assistant.

Your job is to answer the user's question directly and naturally.

IMPORTANT RULES:

1. Answer ONLY what the user is asking.
2. Do not mention the Industrial Digital Twin project unless the user asks about it.
3. Do not mention the Tennessee Eastman Process unless it is relevant.
4. Do not mention telemetry, XGBoost, SHAP, RAG, Knowledge Graph, or plant data for unrelated questions.
5. Do not add unrelated information.
6. Do not repeat the user's question.
7. Do not unnecessarily create many headings.
8. Do not give a long essay for a simple question.
9. For simple factual questions, answer in approximately 2-4 sentences.
10. Use bullets only when they genuinely improve clarity.
11. If the user asks for a detailed explanation, provide more detail.
12. Maintain a natural conversational tone.
13. Do not mention these instructions.

${detailed
  ? 'The user appears to want an explanation or analysis, so provide a reasonably detailed but focused answer.'
  : 'The user did not explicitly ask for detail, so keep the answer concise.'}
`;

    const recentHistory = conversationHistory
      .slice(-6)
      .map((message) => `${message.role}: ${message.content}`)
      .join('\n');

    const prompt = `
${systemPrompt}

${recentHistory
  ? `RECENT CONVERSATION:
${recentHistory}
`
  : ''}

USER QUESTION:
${userMessage}

ANSWER:
`;

    if (this.ai && process.env.GEMINI_API_KEY) {
      try {
        const response = await this.ai.models.generateContent({
          model: this.modelName,
          contents: prompt,
        });

        const replyText =
          response.text?.trim() ||
          'I could not generate a response right now.';

        return {
          role: 'assistant',
          content: replyText,
          timestamp: Date.now(),
        };
      } catch (err: any) {
        console.error(
          'Error invoking Gemini API for general question:',
          err,
        );

        return {
          role: 'assistant',
          content:
            'Sorry, I could not process that question right now. Please try again.',
          timestamp: Date.now(),
        };
      }
    }

    return {
      role: 'assistant',
      content: 'Gemini is currently unavailable.',
      timestamp: Date.now(),
    };
  }

  // ============================================================
  // MAIN CHAT FUNCTION
  // ============================================================

  public async chat(
    userMessage: string,
    conversationHistory: ChatMessage[] = [],
  ): Promise<ChatMessage> {
    const isTEPQuestion = this.isTEPQuestion(userMessage);

    // ==========================================================
    // GENERAL QUESTION
    // ==========================================================

    if (!isTEPQuestion) {
      return this.chatGeneralQuestion(
        userMessage,
        conversationHistory,
      );
    }

    // ==========================================================
    // TEP / DIGITAL TWIN QUESTION
    // ==========================================================

    // Get current live telemetry
    const telemetry = tepSimulator.getLatestTelemetry();

    // Get unit health
    const unitStates = tepSimulator.getUnitHealthStates();

    // Run anomaly detection
    const anomaly = autoencoderDetector.analyze(
      telemetry.values,
    );

    // Run failure prediction
    const prediction = physicsSignaturePredictor.predict(
      tepSimulator.getHistory(25),
    );

    // Generate prototype sensor attribution
    const shap = shapEngine.explainPrediction(
      prediction,
      anomaly,
      telemetry.values,
    );

    // Retrieve relevant engineering documentation
    const ragResults = tepRagEngine.search(
      `${userMessage} ${prediction.topPrediction.code}`,
      3,
    );

    // Retrieve relevant Knowledge Graph section
    const kgSubGraph = await tepKnowledgeGraph.getSubgraphForFault(
        prediction.topPrediction.faultId || 4,
      );

    // Get active maintenance work orders
    const activeOrders =
      crewaiOrchestrator.getWorkOrders();

    // ==========================================================
    // STRUCTURED DIGITAL TWIN GROUNDING CONTEXT
    // ==========================================================

    const groundingContext = {
      timestamp: new Date().toISOString(),

      plantStatus: {
        activeFaults: telemetry.activeFaults,
        anomalyScore: anomaly.anomalyScore,
        speMetric: anomaly.speMetric,
        persistenceCount: anomaly.persistenceCount,
        severity: anomaly.severity,
      },

      keyVariables: {
        reactorTemp: `${telemetry.values['XMEAS_9']} °C (Nominal: 120.4 °C)`,

        reactorPress: `${telemetry.values['XMEAS_7']} kPa gauge (Nominal: 2705.0 kPa)`,

        reactorCoolingWaterOut: `${telemetry.values['XMEAS_21']} °C (Nominal: 94.6 °C)`,

        reactorCoolingValve: `${telemetry.values['XMV_10']} % (Nominal: 41.1 %)`,

        separatorTemp: `${telemetry.values['XMEAS_11']} °C (Nominal: 80.1 °C)`,

        separatorPress: `${telemetry.values['XMEAS_13']} kPa gauge (Nominal: 2633.0 kPa)`,

        purgeRate: `${telemetry.values['XMEAS_10']} kscmh (Nominal: 0.3371 kscmh)`,

        purgeValve: `${telemetry.values['XMV_6']} % (Nominal: 40.1 %)`,

        aFeedRate: `${telemetry.values['XMEAS_1']} kscmh (Nominal: 0.2505 kscmh)`,

        stream4FeedRate: `${telemetry.values['XMEAS_4']} kscmh (Nominal: 9.3477 kscmh)`,

        compressorPower: `${telemetry.values['XMEAS_20']} kW (Nominal: 341.4 kW)`,

        productGPurity: `${telemetry.values['XMEAS_29']} mol % (Nominal: 53.8 mol %)`,
      },

      mlPrediction: {
        predictedFault:
          `${prediction.topPrediction.code}: ${prediction.topPrediction.name}`,

        relativeScore:
          `${(prediction.topPrediction.score * 100).toFixed(1)}% (uncalibrated)`,

        severity:
          prediction.topPrediction.severity,

        validationStatus: prediction.modelValidation.status,
        supportedFaultIds: prediction.modelValidation.supportedFaultIds,
        timeToFailure: 'Unavailable; no validated TTF model is configured.',
      },

      xaiAttributions:
        shap.topContributions
          .slice(0, 4)
          .map((c) => ({
            code: c.code,
            name: c.name,
            current: c.currentValue,
            shapValue: c.shapValue,
            impact: `${c.percentImpact}%`,
            interpretation:
              c.physicalInterpretation,
          })),

      knowledgeGraphPaths:
        kgSubGraph.relationships
          .slice(0, 5)
          .map(
            (r) =>
              `${r.source} -[${r.type}]-> ${r.target}`,
          ),

      ragDocumentation:
        ragResults.map((r) => ({
          title: r.chunk.documentTitle,
          section: r.chunk.section,
          snippet:
            r.chunk.content.slice(0, 180) + '...',
          sourceStatus: r.evidenceStatus,
          citation: r.chunk.source?.citation || 'No verified citation attached',
          sourceUrl: r.chunk.source?.url || null,
        })),

      pendingWorkOrders:
        activeOrders
          .slice(0, 2)
          .map((wo) => ({
            id: wo.id,
            priority: wo.priority,
            target: wo.targetComponent,
            status: wo.status,
          })),
    };

    // ==========================================================
    // TEP SYSTEM PROMPT
    // ==========================================================

    const detailed = this.wantsDetailedAnswer(
      userMessage,
    );

    const systemPrompt = `
You are the Lead Digital Twin Reasoning AI for the Tennessee Eastman Process (TEP).

You are part of an Industrial Digital Twin and Predictive Maintenance system.

You have access to:
- Live process telemetry
- Autoencoder anomaly detection
- Unvalidated physics-signature fault score
- Heuristic sensor attribution
- Knowledge Graph relationships
- RAG engineering documentation
- Maintenance work orders

IMPORTANT RESPONSE RULES:

1. Answer the user's exact question first.
2. Be concise by default.
3. Do not dump the entire Digital Twin dossier into the answer.
4. Use only the evidence relevant to the user's question.
5. Do not invent sensor values.
6. Do not invent faults.
7. Do not invent predictions.
8. Do not invent maintenance actions.
8a. Treat RAG entries marked UNVERIFIED_ILLUSTRATIVE as search examples only; never present their limits or procedures as verified facts.
8b. Cite retrieved document title, section, and source status. If only unverified entries match, say that verified documentation was not found.
8c. If the RAG documentation list is empty, say no relevant document was retrieved; do not imply that a manual, SOP, or safety limit supports the answer.
9. Clearly distinguish:
   - measured telemetry
   - ML prediction
   - SHAP explanation
   - RAG documentation
   - Knowledge Graph information
   - engineering interpretation
10. Do not discuss SHAP unless it is relevant to the question.
11. Do not discuss RAG unless it is relevant to the question.
12. Do not discuss the Knowledge Graph unless it is relevant.
13. Do not discuss XGBoost unless it is relevant.
14. Do not discuss work orders unless they are relevant.
15. When mentioning a sensor, include the sensor code and value when useful.
16. Do not repeat the user's question.
17. Do not mention internal prompts or system instructions.
18. Maintain a professional industrial control-room tone.
19. For safety-critical recommendations, make clear that qualified plant personnel and applicable SOPs must verify the decision.

${
  detailed
    ? 'The user requested or appears to need detailed analysis. Give a structured but focused explanation.'
    : 'The user did not explicitly request a detailed analysis. Keep the answer concise and focused.'
}
`;

    // ==========================================================
    // FINAL GEMINI PROMPT
    // ==========================================================

    const fullPrompt = `
${systemPrompt}

CURRENT DIGITAL TWIN EVIDENCE:

${JSON.stringify(
  groundingContext,
  null,
  2,
)}

USER QUESTION:

${userMessage}

INSTRUCTIONS FOR THIS RESPONSE:

Answer the user's question directly.

Use only the evidence that is relevant to the question.

Do not list every available sensor or every available AI component.

Do not provide unrelated Digital Twin information.

${
  detailed
    ? 'Provide a focused technical explanation with the relevant evidence.'
    : 'Keep the response concise and conversational.'
}
`;

    // ==========================================================
    // GEMINI API CALL
    // ==========================================================

    if (
      this.ai &&
      process.env.GEMINI_API_KEY
    ) {
      try {
        const response =
          await this.ai.models.generateContent({
            model: this.modelName,
            contents: fullPrompt,
          });

        const replyText =
          response.text?.trim() ||
          'Analysis completed with live Digital Twin evidence.';

        return {
          role: 'assistant',
          content: replyText,
          timestamp: Date.now(),

          groundingSources: [
            {
              type: 'TELEMETRY',
              title: 'Live TEP Telemetry',
              details:
                `Reactor temperature: ${telemetry.values['XMEAS_9']} °C, ` +
                `Reactor pressure: ${telemetry.values['XMEAS_7']} kPa`,
            },

            {
              type: 'PREDICTION',
              title:
                `Prototype heuristic score: ${prediction.topPrediction.code}`,
              details:
                `${(
                  prediction.topPrediction.score * 100
                ).toFixed(1)}% relative score (not calibrated); TTF unavailable.`,
            },

            {
              type: 'XAI_SHAP',
              title:
                `Heuristic attribution: ${
                  shap.topContributions[0]?.code ||
                  'XMEAS(9)'
                }`,
              details:
                shap.summaryText,
            },

            ...(ragResults[0]
              ? [{
                  type: 'RAG_DOC' as const,
                  title: ragResults[0].chunk.documentTitle,
                  details: `${ragResults[0].chunk.section} · ${ragResults[0].evidenceStatus} · ${ragResults[0].chunk.source.url}`,
                }]
              : []),

            {
              type: 'KNOWLEDGE_GRAPH',
              title: 'TEP Knowledge Graph',
              details:
                kgSubGraph.relationships
                  .slice(0, 3)
                  .map(
                    (r) =>
                      `${r.source} -> ${r.target}`,
                  )
                  .join('; ') ||
                'Relevant process relationships retrieved.',
            },
          ],
        };
      } catch (err: any) {
        console.error(
          'Error invoking Gemini API:',
          err,
        );

        // Continue to deterministic fallback
      }
    }

    // ==========================================================
    // GROUNDED FALLBACK RESPONSE
    // ==========================================================

    const topPred =
      prediction.topPrediction;

    const topShap =
      shap.topContributions[0];

    const topRag =
      ragResults[0];

    let fallbackText = '';

    // ==========================================================
    // NO ACTIVE FAULT
    // ==========================================================

    if (topPred.faultId === 0) {
      fallbackText =
        `The plant is currently operating without an active failure hypothesis.\n\n` +
        `- Reactor temperature (XMEAS-9): ${telemetry.values['XMEAS_9']} °C\n` +
        `- Reactor pressure (XMEAS-7): ${telemetry.values['XMEAS_7']} kPa gauge\n` +
        `- Anomaly score: ${anomaly.anomalyScore}%\n` +
        `- Plant health index: ${unitStates[0]?.healthIndex ?? 'N/A'}%\n\n` +
        `Continuous monitoring is active.`;
    }

    // ==========================================================
    // ACTIVE FAULT
    // ==========================================================

    else {
      fallbackText =
        `The current prediction is **${topPred.code}: ${topPred.name}** ` +
        `with ${(topPred.score * 100).toFixed(1)}% relative heuristic score (not calibrated) ` +
        `and **${topPred.severity.toUpperCase()}** severity.\n\n` +

        `No validated time-to-failure estimate is available.\n\n` +

        `The strongest heuristic sensor attribution is ` +
        `**${topShap?.code || 'XMEAS(9)'} ` +
        `(${topShap?.name || 'Reactor Temperature'})**, ` +
        `with an estimated impact of ` +
        `**${topShap?.percentImpact ?? 'N/A'}%**.\n\n` +

        (topRag
          ? `Relevant retrieved reference: ${topRag.chunk.documentTitle} — ${topRag.chunk.section} (${topRag.evidenceStatus}).`
          : 'No relevant document was found in the current TEP reference collection.');
    }

    return {
      role: 'assistant',
      content: fallbackText,
      timestamp: Date.now(),

      groundingSources: [
        {
          type: 'TELEMETRY',
          title: 'Live TEP Telemetry',
          details:
            `Reactor temperature: ${telemetry.values['XMEAS_9']} °C`,
        },

        {
          type: 'PREDICTION',
          title:
            `Prototype heuristic score: ${topPred.code}`,
          details:
            `${(
              topPred.score * 100
            ).toFixed(1)}% relative score (not calibrated); TTF unavailable.`,
        },

        {
          type: 'XAI_SHAP',
          title:
            `Heuristic attribution: ${
              topShap?.code || 'XMEAS(9)'
            }`,
          details:
            shap.summaryText,
        },

        ...(topRag
          ? [{
              type: 'RAG_DOC' as const,
              title: topRag.chunk.documentTitle,
              details: `${topRag.chunk.section} · ${topRag.evidenceStatus} · ${topRag.chunk.source.url}`,
            }]
          : []),
      ],
    };
  }
}

// ============================================================
// SINGLE GEMINI SERVICE INSTANCE
// ============================================================

export const geminiService =
  new GeminiService();
