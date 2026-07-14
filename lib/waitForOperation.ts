import {
  OpenAPI,
  OperationsService,
  cwpStatus,
  type cwpOperationStatus,
} from '../iv-sdk-typescript';

const DEFAULT_WS_TIMEOUT_MS = 180_000;

interface WaitOptions {
  wsTimeoutMs?: number;
}

function isTerminal(status: string | undefined): boolean {
  return status === cwpStatus.SUCCEEDED || status === cwpStatus.FAILED;
}

function buildWsUrl(): string {
  const base = OpenAPI.BASE;
  if (!base) throw new Error('OpenAPI.BASE must be set before calling waitForOperation');
  const wsBase = base.replace(/^http/, 'ws');
  return `${wsBase}/api/cwp/events?heartbeat=30`;
}

/**
 * Wait for a CWP operation to reach a terminal state.
 *
 * Connects to `/api/cwp/events` for wake notifications, then confirms via
 * `GET /api/cwp/operations/id/{id}/status`. Also checks status on subscribe
 * so a fast-completing operation is not missed before the socket is up.
 */
export async function waitForOperation(
  operationId: string,
  options: WaitOptions = {},
): Promise<cwpOperationStatus> {
  const { wsTimeoutMs = DEFAULT_WS_TIMEOUT_MS } = options;
  const wsUrl = buildWsUrl();

  return new Promise<cwpOperationStatus>((resolve, reject) => {
    let resolved = false;
    let ws: WebSocket;

    const finish = (op: cwpOperationStatus) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      try { ws?.close(); } catch {}
      resolve(op);
    };

    const fail = (err: Error) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      try { ws?.close(); } catch {}
      reject(err);
    };

    const timeout = setTimeout(() => {
      fail(new Error(`Timeout waiting for operation ${operationId} (${wsTimeoutMs}ms)`));
    }, wsTimeoutMs);

    // Cover the race where the op finishes before the WS is subscribed (events are not replayed).
    void OperationsService.cwpgetOperationStatus(operationId)
      .then((op) => {
        if (isTerminal(op.Status)) finish(op);
      })
      .catch(() => {});

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('WebSocket connected to /api/cwp/events');
    };

    ws.onmessage = async (event) => {
      if (resolved) return;
      try {
        const msg = JSON.parse(typeof event.data === 'string' ? event.data : '');
        const type = msg.Type ?? msg.type;
        let payload = msg.Payload ?? msg.payload;
        if (typeof payload === 'string') {
          payload = JSON.parse(payload);
        }
        const eventOpId = payload?.OperationID ?? payload?.operationID ?? payload?.operationId;

        if (type === 'operation_status_update' && eventOpId === operationId) {
          const op = await OperationsService.cwpgetOperationStatus(operationId);
          if (isTerminal(op.Status)) finish(op);
        }
      } catch {}
    };

    ws.onerror = () => {
      // Native WS error events are opaque; close/timeout handles failure.
    };

    ws.onclose = () => {
      if (!resolved) {
        fail(new Error('WebSocket closed before operation completed'));
      }
    };
  });
}
