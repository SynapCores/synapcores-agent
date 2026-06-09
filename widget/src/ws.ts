/* WebSocket client with exponential-backoff reconnect.
 *
 * Why a tiny wrapper instead of using raw WebSocket: the v1 backend can drop
 * connections on idle (heartbeat=30s on the aiohttp side), corporate proxies
 * sometimes kill long-lived WS, and the host page may sleep on tab background.
 * We want one reconnect path the rest of the widget can ignore.
 *
 * Backoff: 1s → 2s → 4s → 8s → 16s → cap 30s. Cancel on explicit close().
 */

type IncomingHandler = (msg: unknown) => void;
type StatusHandler = (status: 'connecting' | 'open' | 'closed' | 'error') => void;

export interface WsClient {
  send(payload: object): void;
  close(): void;
  status(): 'connecting' | 'open' | 'closed' | 'error';
}

interface ConnectOpts {
  url: string;
  onMessage: IncomingHandler;
  onStatus: StatusHandler;
}

export function createWsClient(opts: ConnectOpts): WsClient {
  let ws: WebSocket | null = null;
  let attempt = 0;
  let closed = false;
  let reconnectTimer: number | null = null;
  let lastStatus: 'connecting' | 'open' | 'closed' | 'error' = 'closed';

  const setStatus = (s: typeof lastStatus): void => {
    if (s === lastStatus) return;
    lastStatus = s;
    opts.onStatus(s);
  };

  const connect = (): void => {
    if (closed) return;
    setStatus('connecting');
    try {
      ws = new WebSocket(opts.url);
    } catch (err) {
      // Most likely a malformed URL — no point auto-retrying that.
      setStatus('error');
      // eslint-disable-next-line no-console
      console.error('@synapcores/widget: bad backend URL', err);
      return;
    }
    ws.addEventListener('open', () => {
      attempt = 0;
      setStatus('open');
    });
    ws.addEventListener('message', (e) => {
      try {
        opts.onMessage(JSON.parse(e.data));
      } catch {
        /* drop malformed frames silently — not the host's problem */
      }
    });
    ws.addEventListener('close', () => {
      ws = null;
      if (closed) {
        setStatus('closed');
        return;
      }
      setStatus('closed');
      scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      // The 'close' listener will fire next and handle reconnect; we just
      // surface the error state so the UI can show "reconnecting…".
      setStatus('error');
    });
  };

  const scheduleReconnect = (): void => {
    if (closed) return;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
    attempt += 1;
    reconnectTimer = window.setTimeout(connect, delay);
  };

  connect();

  return {
    send(payload: object) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
        return;
      }
      // The widget surfaces a friendlier message; the WS-layer just drops
      // sends when not connected. A real queue/replay belongs in Sprint 3
      // alongside persistent conversation state.
    },
    close() {
      closed = true;
      if (reconnectTimer != null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) ws.close();
      ws = null;
      setStatus('closed');
    },
    status() {
      return lastStatus;
    },
  };
}
