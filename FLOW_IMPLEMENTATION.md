# Updated TEP flow: implementation and setup

This project implements the revised flow as an advisory TEP benchmark demonstration. It does not connect to or control a physical DCS/PLC.

## End-to-end path

1. **Telemetry input and checks:** Use the built-in TEP simulator or import a small TEP CSV replay. CSV import validates the file and mapped sensor values. The XGBoost route requires the 38 shared channels and the last 25 samples from a single run.
2. **Detection and diagnosis:** The live simulator uses its configured alarm checks and local diagnosis path. Imported TEP replay can run the trained XGBoost classifier and TreeSHAP. PCA T²/SPE and the MLP autoencoder can be compared separately for anomaly detection.
3. **Operator alert:** A newly raised simulator alarm creates one `CRITICAL_ALARM` webhook event for the Operator. A replay that produces a known fault candidate creates a review draft and an Operator alert; an unknown fault candidate alerts the Operator for Engineer review without asserting a known class. Repeated prediction of the same replay window reuses the existing draft.
4. **Ticket context:** A replay work order includes the class prediction, TreeSHAP sensor contributions, a rule-based severity/confidence/unit-criticality risk score, connected process units from the graph, and retrieved reference snippets. Graph connections and bundled references are advisory and remain subject to engineering/source review.
5. **Engineer review:** Only an Engineer or Admin can approve or reject a draft. Approval requires review notes. Rejection stops the dispatch path.
6. **Technician work order:** Approval sends a `MAINTENANCE_WORK_ORDER` event to n8n with the approved ticket and `recipientRole: TECHNICIAN`. The first active Technician account is assigned when one exists. If the endpoint is not configured, the event is recorded as `SIMULATED`; the Technician can still see the order in the app.
7. **Repair and closure:** The assigned Technician records repair notes. An Engineer or Admin then records the final review note and closes the ticket. The server enforces this order.
8. **Audit:** Alarm creation, notifications, approvals, rejection, technician assignment, repair completion, and final closure are recorded in the local audit trail.

## Create demo accounts

Sign in as Admin and open **Admin · Users**. Create an Operator, an Engineer, and a Technician account. The Technician role can record repair completion only for work orders assigned to that account. Demo passwords must be at least 12 characters.

## Configure n8n for both notification paths

One n8n Webhook endpoint receives both event types. Add a Switch node to route `CRITICAL_ALARM` events to the Operator and `MAINTENANCE_WORK_ORDER` events to the Maintenance Technician. The work-order event is sent only after Engineer approval.

1. In n8n, create a workflow with a **Webhook** trigger that accepts `POST` requests. Set the response mode to reply immediately so the app does not wait for the downstream message node.
2. Add a **Switch** node on `{{$json.body.workflowType}}`.
3. For `CRITICAL_ALARM`, send a Slack/email message to the Operator. Payload fields include `recipientRole`, `event`, `alarms` (or replay fault details), `source`, and `instruction`.
4. For `MAINTENANCE_WORK_ORDER`, send the approved ticket to the Maintenance channel/recipient. Payload fields include `recipientRole`, `recipientName` when an active Technician account exists, `approvedBy`, `orderId`, `priority`, and `workOrder`.
5. Add the Slack/email credential inside n8n. Activate the workflow and copy its **Production URL**.
6. Put that URL in the local `.env` as `N8N_WEBHOOK_URL="..."`, then restart the app. Do not paste the URL or credentials into chat or source control.
7. Inject a demo fault. Confirm the Operator alert is logged immediately. Approve the ticket with Engineer notes and confirm only then that a Technician work-order event appears. Complete the repair as Technician, then close it as Engineer.

The app keeps the webhook path hidden in stored event history. Without `N8N_WEBHOOK_URL`, notifications are logged as simulated and no external message is sent.

## Research/reporting notes

- Cite the exact source and license of the CSV files used. The local artifacts currently mark dataset provenance as unconfirmed.
- The current test set follows the assumed fault onset of sample 160 (first fault-affected sample 161); confirm that against the exact CSV release before reporting detection delay.
- Report the held-out metrics and difficult fault classes, including the PCA run-level false-alarm tradeoff. Do not describe benchmark metrics as plant results.
- TreeSHAP contributions explain the fitted model output; they are not causal proof. Graph traversal reports connectivity for impact review; it is not validated fault propagation.
- The bundled RAG corpus contains cited benchmark/dataset references, not site SOPs. Check each source status; the local CSV provenance and candidate graph mappings still need confirmation.
