/* Upstream WebSocket to the SynapCores gateway.
 *
 * The proxy holds the SynapCores credential (long-lived JWT or API-key-
 * derived JWT in env), not the browser. One upstream WS per active visitor
 * session. Frames flow:
 *
 *   browser  ⇄  proxy  ⇄  SynapCores /ws?token=<server-held>
 *
 * On upstream open: ready event. On upstream message: forward verbatim.
 * On upstream close: emit close to caller so the browser-side WS closes
 * too. The proxy does NOT translate `AiChatWsMessage` shape — both sides
 * speak it; the proxy is just a credentialed pipe.
 */

import { WebSocket } from 'ws';

/**
 * @param {Object} args
 * @param {string} args.apiBase                — http://localhost:8080
 * @param {string} args.token                  — JWT/credential held server-side
 * @param {(msg: Buffer | string) => void} args.onFrame
 * @param {(reason?: string) => void} args.onClose
 * @param {(err: Error) => void} args.onError
 * @returns {{send: (data: any) => void, close: () => void, isOpen: () => boolean}}
 */
export function connectUpstream({ apiBase, token, onFrame, onClose, onError }) {
  const wsBase = apiBase.replace(/^http(s?):\/\//, (_m, s) => `ws${s}://`);
  const url = `${wsBase}/ws?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(url, {
    perMessageDeflate: false,
    // Identify ourselves so SynapCores access logs can distinguish proxy
    // traffic from direct CE connections.
    headers: { 'User-Agent': '@synapcores/widget-proxy' },
  });

  ws.on('open', () => {
    // Nothing — the proxy doesn't initiate; it just forwards what arrives.
  });
  ws.on('message', (data) => {
    // `ws` gives us Buffer for binary, string for text. AiChatWsMessage
    // is always text; we forward as-is.
    onFrame(data);
  });
  ws.on('close', (code, reason) => onClose(`upstream closed code=${code} reason=${reason}`));
  ws.on('error', (err) => onError(err));

  return {
    send(payload) {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
    },
    close() {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    },
    isOpen() {
      return ws.readyState === WebSocket.OPEN;
    },
  };
}
