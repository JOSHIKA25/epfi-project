/**
 * n8n External Automation Integration Service
 * Dispatches automated webhooks and workflows:
 * - Maintenance Work Orders (SAP / Maximo / Jira)
 * - Critical Incident Alerts (PagerDuty / Slack / Teams)
 * - Shift Handover & Reliability Reports (JSON / PDF compilation)
 */

import { stateStore } from '../state/stateStore.ts';

export interface N8nWebhookEvent {
  id: string;
  workflowType: 'MAINTENANCE_WORK_ORDER' | 'CRITICAL_ALARM' | 'SHIFT_REPORT';
  timestamp: number;
  endpointUrl: string;
  status: 'DELIVERED' | 'SIMULATED' | 'FAILED';
  httpStatus: number;
  payload: Record<string, any>;
  responseMessage: string;
}

export class N8nService {
  private defaultWebhookUrl = '';

  public async dispatchWebhook(
    workflowType: 'MAINTENANCE_WORK_ORDER' | 'CRITICAL_ALARM' | 'SHIFT_REPORT',
    payload: Record<string, any>,
    customUrl?: string
  ): Promise<N8nWebhookEvent> {
    const url = (customUrl || process.env.N8N_WEBHOOK_URL || this.defaultWebhookUrl).trim();
    let endpointLabel = '';
    if (url) {
      try { endpointLabel = `${new URL(url).origin}/[path hidden]`; }
      catch { endpointLabel = '[invalid endpoint hidden]'; }
    }
    const eventId = `N8N-EVT-${Date.now().toString(36).toUpperCase()}`;

    let status: 'DELIVERED' | 'SIMULATED' | 'FAILED' = 'SIMULATED';
    let httpStatus = 200;
    let responseMessage = 'Simulation only: no n8n endpoint is configured; no external system was contacted.';

    // Try real HTTP request if real external URL provided (starts with http)
    if (url && (url.startsWith('http://') || url.startsWith('https://')) && !url.includes('.local')) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          signal: AbortSignal.timeout(10_000),
          headers: {
            'Content-Type': 'application/json',
            'X-Source-System': 'TEP-Digital-Twin-AI',
          },
          body: JSON.stringify({
            eventId,
            workflowType,
            timestamp: Date.now(),
            data: payload,
          }),
        });

        httpStatus = res.status;
        status = res.ok ? 'DELIVERED' : 'FAILED';
        responseMessage = res.ok
          ? `n8n webhook accepted the event (HTTP ${res.status}); check n8n Executions to confirm downstream notification delivery.`
          : `Webhook endpoint rejected the request (HTTP ${res.status}).`;
      } catch (err: any) {
        status = 'FAILED';
        httpStatus = 0;
        responseMessage = `Could not reach the configured webhook endpoint: ${err.message || 'network error'}`;
      }
    } else {
      responseMessage = url
        ? `Simulation only: ${url} is a placeholder/local endpoint; no external system was contacted.`
        : 'Simulation only: no n8n endpoint is configured; no external system was contacted.';
    }

    const event: N8nWebhookEvent = {
      id: eventId,
      workflowType,
      timestamp: Date.now(),
      endpointUrl: endpointLabel,
      status,
      httpStatus,
      payload,
      responseMessage,
    };

    stateStore.appendN8nEvent(event);
    stateStore.addAuditEvent({
      category: 'dispatch',
      action: 'N8N_WEBHOOK_DISPATCH',
      actor: 'n8n-service',
      entityType: 'dispatch_event',
      entityId: event.id,
      status: status === 'FAILED' ? 'ERROR' : status === 'SIMULATED' ? 'WARNING' : 'SUCCESS',
      details: {
        workflowType,
        endpointUrl: endpointLabel,
        httpStatus,
        responseMessage,
      },
    });

    return event;
  }

  public getHistory(): N8nWebhookEvent[] {
    return stateStore.getN8nEvents(50);
  }
}

export const n8nService = new N8nService();
