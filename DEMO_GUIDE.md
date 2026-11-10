# Final Year Project Demo Guide

Use this as a speaking and click-through guide for the digital-twin demonstration. The application is a **simulated TEP research prototype**. It is not connected to a real factory, live sensors, PLC/DCS controls, or safety interlocks. Describe every alarm and action as part of the software simulation.

## 1. Start the application

Open PowerShell in the project folder and run:

```powershell
npm.cmd run dev
```

Open the local URL printed in the terminal (normally `http://localhost:3000`). Keep that terminal open. The default `CREWAI_MODE="local"` runs the local diagnostic steps and does not need an LLM API key or the Python service.

If the app is configured for `CREWAI_MODE="remote"`, open a second PowerShell window in the project folder and run:

```powershell
npm.cmd run crew:dev
```

The Python service is normally at `http://127.0.0.1:8000`. Its root `/` may show 404; check `/health` or `/docs` instead. Remote mode requires a configured provider key and can consume provider credits. Local mode is the dependable choice for a repeatable demo.

For the **52-variable benchmark replay pipeline**, the Python ML service is required even when the main app runs in local-agent mode. Start it in a second terminal with `npm.cmd run crew:dev`, then confirm `http://127.0.0.1:8000/ml/health` returns `status: ready` and model `52-variable-alarm-time-xgboost-treeshap`.

Sign in with the admin credentials configured in `.env`. The app opens directly to **TEP workflow → Data → Detect → Diagnose**. From the Admin area, create demo Engineer, Operator, and Technician accounts if they do not already exist. Do not put real passwords or API keys in this guide or presentation slides.

## 2. Explain the project in one minute

> “This project loads TEP process data into one guided workflow. Models fitted from normal and labeled training datasets analyze the incoming sequence: PCA and an autoencoder provide anomaly evidence, and a persistent autoencoder alarm marks the incident. The diagnosis model then waits for a 250-sample evidence buffer and classifies a 25-sample window; TreeSHAP shows which inputs influenced that prediction. The event goes to Operator acknowledgement and Engineer work-order review before a Technician records work. It is a dataset-driven decision-support prototype, not connected to a live factory.”

Simple terms:

- **Telemetry** means the process readings, such as temperature, pressure, or flow.
- **Alarm** means a reading crossed a configured warning or trip limit.
- **IDV / Fault Lab injection** means deliberately adding a named disturbance to the simulator for a demonstration. It is not a real equipment fault.
- **Agent workflow** means software analysis steps that examine the available evidence and produce a report. They do not operate valves or control the process.
- **Acknowledge** means “I have seen this alarm.” **Resolve** means “the reading is back to normal, and I have recorded how this incident was closed.”

## 3. Recommended click-through

### Main demo: one end-to-end dataset-to-review flow

This is the main project demonstration. It loads one prepared 960-sample TEP run with all 52 channels, applies the already-fitted PCA/autoencoder/XGBoost artifacts, and continues into the same operator/engineer/technician workflow. Re-loading the demo file starts a fresh replay incident so you can repeat the walkthrough. The model-preparation panel explains which training datasets and methods produced the artifacts.

1. Start the Python service and confirm `/ml/health` reports the 52-variable alarm-time XGBoost + TreeSHAP model as ready.
2. Sign in as **Operator** and open **CSV replay**. Click **Load prepared TEP demo run**, then **Validate mapping and prepare replay**. The prepared data has 52 features (XMEAS 1–41 and XMV 1–11); the fault label is not sent into the prediction.
3. Play the timeline at 20× until it reaches the end (about 48 seconds), or move the timeline to the last sample. Click **Run PCA + AE detection → XGBoost diagnosis**. The screen reports PCA T²/SPE and autoencoder evidence; the serving alarm rule uses two consecutive autoencoder threshold exceedances. The candidate model waits 250 samples after the first persistent alarm, then classifies the next 25-sample evidence window. If the replay ends before that window is available, it uses the latest complete 25-sample window and marks the fallback. TreeSHAP explains the window used for that diagnosis.
4. Show the first-alarm sample, threshold comparison, diagnosis window, candidate class, and top TreeSHAP features. Explain: this is a candidate fault classification and feature contribution, not proof of a physical cause. The true test label remains hidden during prediction.
5. The pipeline creates a labeled **TEP replay** alarm and attempts an Operator n8n webhook. Verify the event in **Review & Dispatch → Notifications**, then check the n8n **Executions** page and recipient inbox to prove the downstream delivery. An HTTP 200 alone proves webhook acceptance, not that Gmail/Slack sent a message.
6. As Operator, add an observation note and acknowledge this alarm. As Engineer, open the same linked alarm, create its work order, add a review note, and approve/send it to the Technician. Confirm the n8n execution for this approval-gated work-order event.
7. As Technician, open **Work orders**, record the repair performed, and submit. This changes the linked *replay* alarm to “Repair reported · engineer close.” Return as Engineer, close the work order, then separately add the final alarm review note and close the alarm.

The final repair and closure are workflow demonstrations over a recorded benchmark incident. A TEP CSV cannot show that a real unit recovered; only the simulator Fault Lab path can demonstrate values returning to normal after an injected simulator fault is cleared.

### A. Show the process and its current state

1. Sign in as **Admin** or **Engineer** and open the P&ID / process view.
2. Point out the five monitored units: Reactor, Condenser, Separator, Stripper, and Compressor.
3. Explain the simplified process path: Reactor → Condenser → Separator; the Separator has a liquid path to the Stripper and a recycle path through the Compressor back to the Reactor.
4. Show the simulation label and the Pause, Resume, Step, and Reset controls. Pause and Step are controls for this software simulation only.
5. Open the full variable list (41 process variables) to show detailed readings. Use the alarm-only filter when you want to focus on flagged readings.

### B. Inject one demonstration fault

1. Open **Fault Lab** and choose a supported IDV scenario with clear key sensors. Inject it once.
2. Return to the P&ID. Point to the affected unit, the leading sensor/deviation, and the visible agent analysis state/report.
3. Open **Alarm Review**. The Active Fault Lab scenarios area shows the injected scenario and its key sensor evidence. The sensor alarm list shows channels whose readings actually crossed configured limits.
4. Explain that an injected IDV is the simulator's known scenario label. It is not automatically the same thing as a sensor alarm; an alarm appears when a channel meets its alarm rule.
5. If a trip pauses the simulated process, explain that it is a demo pause for inspection, not a physical plant trip.

### C. Show recovery and role permissions

1. In **Alarm Review**, use **Clear simulated fault** for the active scenario. This removes the simulated disturbance; it does not directly mark sensor alarms resolved.
2. If the simulation is paused, use **Step** to advance samples while inspecting recovery, or use **Resume** to continue. A sensor alarm stays open until its current reading returns to normal.
3. Sign in as **Operator** and show that the operator can add a note and acknowledge an alarm. The detailed engineer review is disabled for this role.
4. Sign in as **Engineer** or **Admin** and show the detailed review form. Add the evidence/decision note and save the review.
5. Resolve only after the sensor reading is normal. The Operator must acknowledge first and add a resolution note; Engineer/Admin use the review/resolution action and its note. If the value is still out of range, explain why Resolve is unavailable.

Use a demo IDV and demo accounts during this sequence. Reset the simulated plant between attempts if the scenario or readings are left in an inconvenient state. Reset changes simulated state; it does not fix or control real equipment.

### D. Show the analysis and automation boundaries

1. Open the CrewAI/agent board and show the steps, evidence, and generated report. The app performs deterministic local checks by default. Remote CrewAI is optional and can use an LLM provider when configured.
2. Explain that the unit monitors and analysis workflow are advisory. The five unit specialists are not five independent controllers and do not block physical material flow.
3. If time permits, show Maintenance and Automation/n8n. n8n receives an event payload only when configured with a webhook. Without a real webhook, the app records a simulated outcome; downstream email/chat/CMMS actions must be built in the user's n8n workflow.

## 4. Answers to common demo questions

**Is this live factory data?** No. The main workflow processes TEP CSV data and fitted research model artifacts. It is not connected to physical sensors, a PLC/DCS, or a historian. A real connection would need an approved OT data path, tag mapping, unit validation, and site review.

**Does the software stop the real process?** No. Pause/Step affect only the local simulator. Real trips and interlocks belong to validated plant control and safety systems.

**Why did a simulated trip stop changing?** A configured trip can pause the demo simulator so the event can be inspected. Clear the injected scenario, then Step or Resume to observe the simulated reading recover. Resolve the alarm only after the reading is normal.

**Does every IDV produce the same alarm?** No. An IDV is a scenario label with associated evidence channels. Individual sensor alarms depend on the current values and the configured limits.

**Does an AI agent make the process safer or control it?** The workflow provides structured analysis and recommendations for human review. It does not control equipment, and the model or rules are not safety validated.

**What is required for live deployment?** Approved sensor/historian integration, validated equipment/tag mapping and limits, authenticated role controls, durable audit storage, site-approved procedures, integration testing, and safety/operations approval.

## 5. Optional: show detailed agent values in PowerShell

To inspect the values passed through orchestration steps, set `AGENT_TRACE="true"` in `.env`, stop the app with `Ctrl+C`, and restart it with `npm.cmd run dev`. Trigger an analysis from the UI. The terminal prints `[AgentTrace]` blocks with inputs and outputs. Turn tracing off afterward; logs can contain telemetry and are noisy, so review them before sharing.

## Suggested closing

> “The demonstration links simulated process telemetry, threshold alarms, unit-level context, analysis reports, and human incident review. It demonstrates how the workflow could support an engineer. Connecting it to a real process would require validated plant data and safety-approved integration.”
