<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

For a presentation-ready, step-by-step walkthrough, see [DEMO_GUIDE.md](DEMO_GUIDE.md).

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/3c6e531c-41ae-4b61-bc17-80335b5d3dff

## Run Locally

**Prerequisites:** Node.js and Python 3.10+


1. Install dependencies:
   `npm install`
2. Install the Python CrewAI service dependencies (including the Google Gen AI provider used for Gemini):
   `python -m pip install -r crew_service/requirements.txt`
3. Copy `.env.example` to `.env`; configure `GEMINI_API_KEY` and the credential for the selected `CREWAI_MODEL` provider if using those services.
4. Set `AUTH_ADMIN_EMAIL` and a private `AUTH_ADMIN_PASSWORD` of at least 12 characters in `.env`. The first app start creates the initial admin account. The admin can then create operator and engineer demo accounts in the Admin tab.
5. Optionally configure Neo4j using `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, and `NEO4J_DATABASE`. If omitted, the graph uses the local prototype model.
6. Only if `CREWAI_MODE="remote"`, start the optional Python CrewAI service in one terminal:
   `npm run crew:dev`
7. Run the digital-twin app in another terminal:
   `npm run dev`

The five-step local diagnostic sequence is the default and does not call an LLM, require a CrewAI URL, or use provider API tokens. The dashboard does not run a CrewAI mission on page load. It continuously checks local unit health and dispatches the five unit specialists in process-topology order when a unit reaches `DEGRADED`/`CRITICAL` or a simulator fault is injected: Reactor → Condenser → Separator → Stripper liquid branch → Compressor recycle branch → Plant Coordinator. Each specialist reviews its own unit and passes a clear or flagged result onward, including when its unit is normal. The Stripper and Compressor are separate paths leaving the Separator; the Compressor recycle returns to the Reactor. In remote mode this event path runs six sequential CrewAI tasks. Plant events are throttled to one chain every fifteen minutes by default (`CREWAI_EVENT_COOLDOWN_MS`); manual general missions remain available from the agent board. Set `CREWAI_MODE="remote"` to use the optional Python CrewAI service; on provider, tool-call, rate-limit, or network errors the app falls back to local unit analysis.

To inspect values passed through each step in the PowerShell window running the app, set `AGENT_TRACE="true"` in `.env`, stop the app with Ctrl+C, and restart it with `npm.cmd run dev`. Trigger an orchestration from the app; the terminal prints `[AgentTrace]` JSON blocks with shared telemetry and the input/output of each step. Set it back to `false` when finished because the output is verbose. Traces may include operational telemetry, so do not share them publicly without reviewing them.

For Fault Lab scenarios, injected fault labels are used as simulator ground truth to create a pending review ticket. Such a ticket is labelled `SIMULATOR_INJECTION`; this is scenario playback, not an ML detection result. In ordinary operation with no injected scenario, tickets are created only when a supported model candidate passes the configured threshold. Model limitations are documented below.

The demo login uses `ADMIN`, `ENGINEER`, and `OPERATOR` roles. Sessions use an HTTP-only same-site cookie and expire after 12 hours or when the server restarts. Account password hashes and role records are stored with local app state. This is suitable for a controlled FYP demonstration, not a public production deployment.

When Neo4j credentials are present, startup verifies the connection, creates per-label
composite uniqueness constraints, and idempotently seeds the TEP research graph nodes and
relationships. Legacy app-generated symptom/placeholder-SOP nodes are archived and
excluded from active graph reads without deleting the stored records. The Knowledge Graph page displays the connection status. Check
`GET /api/kg/health` to inspect status and app-scoped counts. The page only submits
allowlisted read-only query IDs; it never submits arbitrary Cypher from the browser.
Use a dedicated database or confirm the target database's constraints before sharing
it with other applications.

Run `npm run neo4j:check` to perform a read-only connectivity check and report app-scoped
node/relationship counts plus the sensor-to-unit query row count. This script does not seed
or modify the database.

The live MLP autoencoder uses its artifact's row-quantile threshold by default. Setting
`TEP_AE_APPLY_RUN_CALIBRATION="true"` opts into the matching single-split TEP run-calibrated
threshold sidecar. The sidecar verifies the dataset hash, seed, calibration run count, and
base threshold before use. This offline benchmark calibration is not validated for the
simplified live simulator or a physical plant.

New alarm records and operator webhook dispatch are synchronized by the server's simulator
loop; `GET /api/tep/state` is read-only. A webhook HTTP 2xx confirms endpoint acceptance,
not delivery by downstream email or messaging nodes; verify n8n Executions and the recipient.

## Agent workflow and project status

### Current twin scope and data provenance

The application currently runs a **simplified TEP research simulation**. Its continuously
changing telemetry is generated inside `server/tep/tepSimulator.ts`; it is not read from a
physical plant, control system, or historian. The header labels this mode explicitly. A
connection to Neo4j does not change the telemetry source or validate the process model.

`GET /api/tep/variables` returns each simulated channel with its training-data mapping and a
data profile. The current normal-only autoencoder uses 38 channels (XMEAS 1–27 and XMV
1–11). XMEAS 28–29 are excluded because the current simulator catalog meanings are not
aligned with the corresponding training-data columns; XMEAS 30–41 and XMV 12 are not
modeled/trained. The workspace now has separate normal/fault training and testing CSVs.
The existing autoencoder remains normal-only; a supervised candidate is trained from the
separate training files and evaluated against held-out test files. The first held-out heuristic baseline evaluation
classified 1,047 runs at end-of-run with 48.8% accuracy and 5.7% macro-F1, demonstrating
that the existing heuristic is not adequate. These local dataset files have not had their
source/license independently verified. The mappings and metrics do not establish that the
simplified simulator reproduces benchmark dynamics or generalize to a physical plant.

By default, the TypeScript orchestrator runs five local evidence-review steps in sequence. This mode needs no LLM provider key and creates tickets for simulator-injected scenarios with their source clearly labelled. Set `CREWAI_MODE="remote"` to call the optional Python CrewAI service; on provider, tool-call, rate-limit, or network errors, the local steps continue and add the remote failure to the agent log. The five steps are:

1. Process health and anomaly scoring
2. Fault prediction
3. Heuristic sensor attribution
4. Knowledge-graph diagnosis
5. RAG-backed maintenance recommendation

The live plant-state response also includes five independent, deterministic per-unit
telemetry monitors for the reactor, condenser, separator, stripper, and compressor. They
display the simulator's mapped channel values and existing alarm/health results; they do
not run a separate LLM per unit, issue actuator commands, or grant permission to pass
material to another unit. TEP is a coupled continuous process, not a batch of discrete
agent-controlled handoffs. Physical alarms, trips, and interlocks must remain within the
site's validated control and safety systems; these application monitors are advisory and
currently see simulated telemetry only.

The per-unit board also applies a software-only review dependency: condenser review
depends on reactor review, separator on condenser, stripper on separator, and the
compressor recycle branch on separator. An upstream unit needing review marks dependent
digital assessments `HOLD_REVIEW` and identifies the source unit. This is a snapshot
workflow indicator only: it neither pauses physical flow nor blocks PLC/DCS processing,
and the TEP recycle loop is not a physical-stage command sequence. A real deployment
requires site engineers to validate the asset topology, data quality, alarm logic, and
the meaning of any review gate.

An assessment is not marked ready when an expected upstream unit is absent, or when
its own telemetry channel value/alarm is unavailable. Incomplete telemetry is displayed
as a data-quality review with health unavailable; dependent digital reviews are held.
The gate is recomputed from each snapshot: it clears when upstream monitors return to
the existing `OPTIMAL` state and complete telemetry. No new alarm threshold or
operator-acknowledgment behavior is implied by this prototype.

The service defaults to `openai/gpt-4o-mini`. For Groq, set `CREWAI_MODEL` to `groq/<model-id>` and `GROQ_API_KEY` in `.env`; the service routes Groq through its OpenAI-compatible API. Other providers may use CrewAI/LiteLLM-supported model IDs and their corresponding credentials. Work orders are created only for a supported fault signature with a relative score of at least 0.25, and still require engineer approval. Their lifecycle is `PROPOSED_PENDING_ENGINEER` → `APPROVED` → `DISPATCHED_TO_N8N`; a rejected order cannot be dispatched. If n8n reports a failed dispatch, the order stays approved so an engineer can retry. The agents only produce analysis and draft checks; they cannot issue plant-control commands.

### Updated Operator and Technician flow

See [FLOW_IMPLEMENTATION.md](FLOW_IMPLEMENTATION.md) for the full implementation walkthrough and n8n setup.

1. Create Operator, Engineer, and Technician accounts in **Admin · Users**.
2. Run telemetry in **Fault Lab** or map and replay a labeled TEP CSV in **Data Replay**. Newly raised simulator alarms immediately produce an Operator event. Persistent PCA/autoencoder alerts and XGBoost replay fault candidates also produce Operator events, with a replay cooldown to avoid repeated notifications.
3. A known XGBoost replay candidate creates a draft work order containing the model result, TreeSHAP sensor contributions, rule-based risk, graph impact context, and retrieved references. Those graph and document contents remain advisory until their sources are reviewed.
4. An Engineer reviews the evidence and approves or rejects with written notes. The app sends a Technician work-order event only after approval. A rejected ticket cannot be dispatched. The first active Technician account is assigned when available.
5. The assigned Technician records the repair. An Engineer then records final review notes and closes the order. The app records each transition in its local audit history.

The n8n endpoint accepts events; the user's workflow must route `CRITICAL_ALARM` to the Operator and `MAINTENANCE_WORK_ORDER` to the Maintenance Technician (for example through Slack or email). Without `N8N_WEBHOOK_URL`, events are marked `SIMULATED` in the app, and no external message is sent. A failed real delivery leaves the order approved so dispatch can be retried.

The current project is an integrated research prototype, with the following validation and production work still outstanding (highest impact first):

1. **Validate fault diagnosis with labeled data.** Separate normal/fault training and testing CSVs are available locally. The active predictor remains the hand-coded baseline for fault IDs 1, 2, 4, 5, 6, 14, 16, 20, and 21; its relative scores are uncalibrated, and no TTF estimate is available. Its held-out end-of-run baseline scored 48.8% accuracy and 5.7% macro-F1. The offline XGBoost candidate reached 89.4% accuracy and 81.4% macro-F1 in its saved evaluation, while an MLP candidate reached 86.1% accuracy and 78.1% macro-F1. The multi-window experiment is described below; none of these benchmark models is validated for production or safety decisions.
2. **Make all operational state durable and auditable.** Work orders and webhook events are persisted locally; long-term audit retention and production database policy still need definition.
3. **Complete knowledge sources and integrations.** Neo4j can be configured for the research graph; candidate topology and fault-to-variable mappings still need source review. RAG currently indexes three cited TEP references and has no site SOP corpus or semantic search. n8n uses a simulated local response unless a webhook is configured. Confirm CSV provenance and add approved documents before using site-specific evidence.
4. **Harden before any operational use.** Authentication and role checks cover the implemented demo actions, but require security review. Add automated coverage for simulator alarms, role boundaries, lifecycle transitions, and webhook failure/retry behavior before relying on it operationally.

### Train and use the TEP XGBoost classifier

The benchmark CSV replay can use an XGBoost fault classifier with TreeSHAP explanations.
It uses the aligned 38 channels (XMEAS 1–27 and XMV 1–11), computes last/mean/standard
deviation/slope features from the final 25 samples of each run, holds out complete runs
for validation, and evaluates on the separate testing CSVs. The validation-selected
unknown-fault rule abstains when a fault candidate's class score is below its threshold.
The output is advisory and is not calibrated for plant use.

Install `crew_service/requirements.txt`, then run:

```sh
npm run ml:train-xgboost
```

The trainer writes the XGBoost model and evaluation metadata under
`server/ml/artifacts/xgboost/`. Start the local service in another terminal with
`npm run ml:service`. In **Data Replay**, map all 38 model channels and classify the final
25-reading window of one TEP run. This route intentionally does not apply a benchmark-trained
model to the simplified built-in simulator. Test-set metrics displayed in replay describe
the held-out CSV evaluation, not the uploaded window and not a physical plant.

The classifier evaluation reports run-level accuracy, macro-F1, per-fault scores, fault
detection rate (the share of faulty runs detected), and false alarm rate (the share of
normal runs flagged). Unknown predictions count as detected faults for binary detection,
but are not counted as correct fault-class predictions. The comparison with the existing
MLP, when its artifact is available, uses the same held-out runs and end samples; the MLP
uses only the final raw sensor sample while XGBoost uses temporal window statistics, so this
is a comparison of the two implemented feature/model pipelines rather than an isolated
model-only experiment.

#### Multi-window diagnosis experiment

An offline multi-window experiment trains XGBoost on four 25-sample windows per
training run (ending at samples 200, 300, 400, and 500), while keeping all windows
from each run in the same split. On the supplied held-out testing runs, its
validation-calibrated gated result was 91.2% accuracy and 84.4% macro-F1, compared
with 90.0% accuracy and 82.3% macro-F1 for the single-window model retrained on the
same training split. Fault detection recall was 85.5% versus 84.4%, with 1.0% versus
1.2% normal-run false alarms. This is a final-window diagnosis result, not alarm-time
end-to-end accuracy; it still misses Faults 9 and 15 and detects only 1/28 Fault 3
runs. The experiment does not replace the serving artifact. Reproduce it with
`python -m crew_service.multiwindow_diagnosis_experiment`; its configuration, data
hashes, validation results, and held-out comparison are saved at
`outputs/multiwindow_diagnosis/validation_results.json`.

### Train and compare PCA anomaly detection

PCA is fit only on normal training runs. The command holds out separate normal simulation
runs for calibration and normal holdout, calculates Hotelling's T² and SPE/Q, and sets
separate limits from the configured calibration quantile. It evaluates the two-consecutive-
sample alarm rule on held-out normal and fault CSVs and compares results with the existing
MLP autoencoder on the same evaluation rows.

```sh
npm run ml:train-pca
```

The report includes normal-run false alarms, fault-run detection, per-fault detection,
sample-level rates, and an assumed fault-onset sample for detection-delay calculations.
Confirm that the onset assumption matches this TEP CSV version before using delay results
in a paper. PCA anomaly scores flag unusual operation; they do not identify the fault class.
The limits are statistical benchmark thresholds, not plant alarm limits.

### Train the TEP normal-operation autoencoder

Place `TEP_FaultFree_Training.csv` in the repository root (the dataset is intentionally
git-ignored because it is large), install `crew_service/requirements.txt`, then run:

```sh
npm run ml:train-autoencoder
```

The trainer uses only 38 verified channels shared with the current simulator (XMEAS 1–27
and XMV 1–11). XMEAS 28–29 use different meanings in the app's current simulator catalog
than the supplied TEP columns, and are therefore excluded; XMV 12 and XMEAS 30–41 are not
available in the app simulator. It excludes
metadata/labels from model inputs, requires `faultNumber=0`, and splits by complete
`simulationRun` into training, calibration, and normal holdout groups. It exports an
undercomplete MLP autoencoder and calibrates its reconstruction-error threshold at the
configured 99.5th percentile of normal calibration runs. The artifact is written to
`server/ml/artifacts/tep_autoencoder.json`; its metadata records the dataset hash, split
sizes, calibration, and normal-holdout false-alarm rate.

This is a learned statistical anomaly threshold, not a safety trip limit. Existing
per-variable simulator warning/trip rules remain separate. A fault-free dataset can
estimate normal false alarms, but it cannot establish fault-detection recall or accuracy;
those require separate fault-labeled data held out by run. Confirm and document the
dataset's source and license before distributing the dataset or making benchmark claims.

The reported normal holdout rate is measured on held-out rows from the supplied dataset;
it is not a live-simulator false-alarm rate. The simplified simulator still drifts away
from the real-data distribution during long fault-free runs, so its anomaly alerts are
not yet validated as fault detections. Do not use them as operational or safety decisions.

### Knowledge graph and engineering reference exports

See [GRAPH_RAG_RESEARCH_NOTES.md](GRAPH_RAG_RESEARCH_NOTES.md) for the graph schema,
evidence status meanings, source citations, and the next retrieval evaluation step.

The Knowledge Graph tab uses Neo4j when credentials are configured and verified; without
them it runs against an in-memory graph. The browser can run only a fixed set of read-only
query templates, not arbitrary Cypher. It stores benchmark fault labels, TEP variable
entities, candidate unit mappings, and candidate fault-to-variable associations. The
association and unit-mapping edges are explicitly marked for source review; they are not
causal evidence. Startup archives the app's legacy generated symptom/placeholder-SOP nodes
and excludes them from active graph reads without deleting the stored records.
The RAG tab searches three cited entries (the benchmark paper, dataset record, and a
published fault catalog) using a pre-indexed BM25-style lexical/entity ranker. It does not
currently use embeddings or semantic retrieval. Dataset metadata is not proof of the local
CSV files' provenance; confirm the exact download/version/license before publication.
No site safety limits, SOPs, or work instructions are included in this corpus.

From the Knowledge Graph tab, download the graph as JSON or its relationships as CSV.
From the RAG tab, download an individual entry as Markdown or the full knowledge pack
as Markdown, JSON, or print-ready HTML. Open the HTML in a browser and use Print →
Save as PDF to create a local PDF. Exports retain citations, evidence status, and a note
that the graph's candidate mappings are not validated. Before adding plant-specific
knowledge, provide approved documents with revision/page provenance and have a qualified
engineer review the extracted facts and relationships.

### Local telemetry CSV replay

The **Data Replay** tab is an isolated local preview. Upload a CSV (maximum 5 MB and
10,000 rows), map one timestamp column and one or more sensor columns to TEP variables
or preserve them as custom replay channels, validate the full file, then play, pause,
step, scrub, or change replay speed. A local alias adapter suggests mappings for
scoped physical names (for example `reactor_temp`); generic names such as `temperature`
or `pressure` remain ambiguous and require a manual selection. Signals without a
meaningful TEP equivalent (for example `vibration`) remain custom channels. Alias
matching is semantic only: it does not convert units or imply that sensor limits or
the TEP prediction model apply to imported equipment. Numeric timestamps may be Unix
seconds or milliseconds; date strings are also accepted. CSV replay values do not
modify the simulator, live telemetry, anomaly or prediction APIs, or live work orders.
After confirming compatible units, a flagged replay unit can be explicitly sent to the
five unit specialists and plant coordinator for an isolated replay analysis; this is separate
from live telemetry and does not create a maintenance work order. In local mode this uses
local threshold logic; in remote mode it runs the six sequential CrewAI tasks. Replay
analysis has its own plant-wide cooldown. The current replay sample can also be shown in a per-unit monitor overlay
using only mapped channels. Reference-envelope assessment stays disabled until the user
confirms compatible units; unconfirmed inputs show values without alarm classification.
This overlay is replay-only and does not alter simulator or live-plant state.

Replay also provides a guided incident-review timeline. Engineers can add timestamped
review notes and select timeline entries to seek back to the corresponding replay sample.
Optional TEP warning/trip reference-envelope observations are disabled until the user
confirms that mapped CSV values use the same units as the selected TEP variables. These
are replay-only comparisons for the per-unit overlay and timeline, not live alarms,
diagnoses, validated site limits, or persisted records. Variables explicitly marked as
semantically mismatched or unavailable in the benchmark are excluded from per-unit
assessment; uploading a new file or preparing a new mapping clears the prior replay's
notes.

Useful validation commands:

```sh
npm run lint
npm run build
npm run test:models
npm run test:crew
npm run test:unit-agents
npm run test:telemetry-csv
npm run test:autoencoder
npm run test:knowledge-exports
npm run test:neo4j
```

To train the supervised TEP fault-classifier candidate and evaluate it on the separate
testing files:

```sh
npm run ml:train-fault-classifier
npm run evaluate:tep-csv -- --model supervised fault_free_testing.csv faulty_testing.csv
```

The trainer reads the local fault-free and fault training CSVs in chunks, uses XMEAS 1–27
and XMV 1–11, trains on the final 25 samples of each 500-sample training run, and holds
every fifth `simulationRun` out within each class for validation. It selects the
fault-vs-normal decision threshold by maximizing Youden's J (recall minus false-positive
rate) over measured grouped-validation operating points, rather than using a hand-picked
score cutoff, and reports the threshold and objective with test results. This is a threshold
on the model's `1 - P(normal)` score, not a calibrated probability or safety limit. The
separate testing CSVs are not
used to train or tune the model. The evaluation classifies each run once from its final
25 samples; it does not measure fault onset or detection delay. The candidate is not
automatically substituted into the live agent workflow. Confirm dataset source/license,
benchmark signal semantics, and engineering suitability; test metrics do not establish
real-plant performance or permit safety-critical use.

To evaluate a held-out labeled telemetry JSON file, use
`npm run evaluate:model -- path\to\held-out-dataset.json` for the heuristic fault classifier, or
`npm run evaluate:autoencoder -- path\to\held-out-dataset.json` for the learned normal-operation autoencoder.
The autoencoder evaluator expects an array of
`{ "faultId": 0, "history": [<TelemetryPoint>, ...] }` samples. It reports binary anomaly metrics
(accuracy, precision, recall, F1, false-alarm rate, and detection delay) and per-fault detection summaries,
while explicitly noting that this is a normal-vs-fault anomaly detector and not a multi-class fault classifier.
Keep target labels separate from training/tuning data.
