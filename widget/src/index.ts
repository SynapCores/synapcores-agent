/* @synapcores/widget — Sprint 0 spike.
 *
 * Drop-in chat widget. Proves: a vanilla TS bundle on a static HTML page can
 * open a WebSocket to the existing v1 synapcores-agent backend and exchange a
 * turn end-to-end. Sprint 1 hardens the UI; this file establishes the wire.
 *
 * Wire protocol (matches v1 web.py — DO NOT change without a backend bump):
 *   client → server: { type: "turn", user_id, text }
 *   server → client:
 *     { type: "thinking" }
 *     { type: "brain", recalled_memory, kb_hits, route, chosen_tool, source, embed_dim }
 *     { type: "reply", text }
 *
 * The "brain" payload is ignored in Sprint 0 — it's the right-pane debug
 * sidebar from the v1 full-page demo, polish for Sprint 1+.
 */

// Injected at build time by esbuild `define` from package version + styles.css.
declare const __SC_WIDGET_VERSION__: string;
declare const __SC_WIDGET_CSS__: string;

// ---------- Config ----------

interface WidgetConfig {
  /** WebSocket URL of the synapcores-agent backend. e.g. ws://localhost:8810/ws */
  backend: string;
  /** Project id — ignored in Sprint 0 (single-tenant v1 backend); wired in Sprint 2. */
  project?: string;
  /** Agent display name in the header. */
  agentName?: string;
  /** First message shown when the panel opens. */
  greeting?: string;
}

type IncomingMsg =
  | { type: 'thinking' }
  | { type: 'brain'; [k: string]: unknown }
  | { type: 'reply'; text: string };

// ---------- Visitor ID (Web Crypto UUID in localStorage, cookie fallback) ----------

const VISITOR_KEY = 'synapcores_visitor';

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}

function writeCookie(name: string, value: string): void {
  // 1 year; SameSite=Lax so it travels on top-level navigations but not
  // 3rd-party fetches (fine — the widget runs on the embedding origin).
  const exp = new Date(Date.now() + 365 * 24 * 3600 * 1000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${exp}; path=/; SameSite=Lax`;
}

function getVisitorId(): string {
  // Try localStorage first (survives ITP better than 3rd-party cookies). If
  // the host page is in private mode or has localStorage blocked, fall back
  // to a cookie. If even that fails (e.g. cookies disabled), use an in-memory
  // id — the visitor still gets a coherent session, just not cross-reload.
  try {
    const cached = localStorage.getItem(VISITOR_KEY);
    if (cached) return cached;
    const fresh = crypto.randomUUID();
    localStorage.setItem(VISITOR_KEY, fresh);
    return fresh;
  } catch {
    /* localStorage blocked — fall through to cookie */
  }
  const cookieVal = readCookie(VISITOR_KEY);
  if (cookieVal) return cookieVal;
  const fresh = crypto.randomUUID();
  try {
    writeCookie(VISITOR_KEY, fresh);
  } catch {
    /* cookies blocked too — id is in-memory only for this session */
  }
  return fresh;
}

// ---------- DOM ----------

function injectStylesOnce(): void {
  if (document.getElementById('sc-widget-styles')) return;
  const style = document.createElement('style');
  style.id = 'sc-widget-styles';
  style.textContent = __SC_WIDGET_CSS__;
  document.head.appendChild(style);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Partial<Record<string, string>> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const k of Object.keys(attrs)) {
    const v = attrs[k];
    if (v != null) node.setAttribute(k, v);
  }
  for (const c of children) {
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

// ---------- Widget ----------

class Widget {
  private cfg: Required<WidgetConfig>;
  private visitor: string;
  private ws: WebSocket | null = null;
  private root!: HTMLDivElement;
  private panel!: HTMLDivElement;
  private messages!: HTMLDivElement;
  private input!: HTMLInputElement;
  private sendBtn!: HTMLButtonElement;
  private thinkingEl: HTMLElement | null = null;
  private isOpen = false;

  constructor(cfg: WidgetConfig) {
    if (!cfg.backend) throw new Error('@synapcores/widget: `backend` is required');
    this.cfg = {
      backend: cfg.backend,
      project: cfg.project ?? '',
      agentName: cfg.agentName ?? 'Support',
      greeting: cfg.greeting ?? 'Hi! How can I help?',
    };
    this.visitor = getVisitorId();
    injectStylesOnce();
    this.mount();
  }

  private mount(): void {
    this.root = el('div', { class: 'sc-widget-root', 'data-version': __SC_WIDGET_VERSION__ });

    const launcher = el(
      'button',
      { class: 'sc-launcher', 'aria-label': 'Open chat' },
      // Inline SVG — no asset host required.
      (() => {
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        const path = document.createElementNS(svgNS, 'path');
        path.setAttribute(
          'd',
          'M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2z',
        );
        svg.appendChild(path);
        return svg;
      })(),
    );
    launcher.addEventListener('click', () => this.toggle());

    this.panel = el('div', { class: 'sc-panel', role: 'dialog', 'aria-label': 'Chat' });

    const header = el(
      'div',
      { class: 'sc-header' },
      el('span', {}, this.cfg.agentName),
      (() => {
        const btn = el('button', { class: 'sc-header-close', 'aria-label': 'Close chat' }, '×');
        btn.addEventListener('click', () => this.close());
        return btn;
      })(),
    );

    this.messages = el('div', { class: 'sc-messages', 'aria-live': 'polite' });

    const form = el('form', { class: 'sc-composer' });
    this.input = el('input', {
      class: 'sc-input',
      type: 'text',
      placeholder: 'Type your message…',
      'aria-label': 'Message',
    }) as HTMLInputElement;
    this.sendBtn = el('button', { class: 'sc-send', type: 'submit' }, 'Send') as HTMLButtonElement;
    form.appendChild(this.input);
    form.appendChild(this.sendBtn);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.send(this.input.value);
    });

    const footer = el(
      'div',
      { class: 'sc-footer' },
      (() => {
        const a = el(
          'a',
          { href: 'https://synapcores.com', target: '_blank', rel: 'noopener noreferrer' },
          'Powered by SynapCores',
        );
        return a;
      })(),
    );

    this.panel.appendChild(header);
    this.panel.appendChild(this.messages);
    this.panel.appendChild(form);
    this.panel.appendChild(footer);

    this.root.appendChild(launcher);
    this.root.appendChild(this.panel);
    document.body.appendChild(this.root);

    this.addBubble('agent', this.cfg.greeting);
  }

  private toggle(): void {
    this.isOpen ? this.close() : this.open();
  }

  open(): void {
    this.panel.classList.add('sc-open');
    this.isOpen = true;
    setTimeout(() => this.input.focus(), 50);
    this.ensureConnected();
  }

  close(): void {
    this.panel.classList.remove('sc-open');
    this.isOpen = false;
  }

  private ensureConnected(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    try {
      this.ws = new WebSocket(this.cfg.backend);
    } catch (err) {
      this.addBubble('agent', `(connection error: ${(err as Error).message})`);
      return;
    }
    this.ws.addEventListener('message', (e) => {
      try {
        const msg: IncomingMsg = JSON.parse(e.data);
        this.onMessage(msg);
      } catch {
        /* ignore malformed frames */
      }
    });
    this.ws.addEventListener('close', () => {
      this.ws = null;
    });
    this.ws.addEventListener('error', () => {
      this.addBubble('agent', '(connection closed — please retry)');
    });
  }

  private onMessage(msg: IncomingMsg): void {
    switch (msg.type) {
      case 'thinking':
        this.showThinking();
        break;
      case 'brain':
        // Sprint 1+ wires this to a debug surface; spike ignores.
        break;
      case 'reply':
        this.hideThinking();
        this.addBubble('agent', msg.text);
        this.sendBtn.disabled = false;
        this.input.disabled = false;
        this.input.focus();
        break;
    }
  }

  send(text: string): void {
    const t = (text ?? '').trim();
    if (!t) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Buffer is overkill for the spike; just nudge a reconnect and tell the user.
      this.addBubble('agent', '(still connecting…)');
      this.ensureConnected();
      return;
    }
    this.addBubble('user', t);
    this.input.value = '';
    this.sendBtn.disabled = true;
    this.input.disabled = true;
    this.ws.send(JSON.stringify({ type: 'turn', user_id: this.visitor, text: t }));
  }

  private addBubble(from: 'user' | 'agent', text: string): void {
    const cls = from === 'user' ? 'sc-bubble sc-bubble-user' : 'sc-bubble sc-bubble-agent';
    const bubble = el('div', { class: cls }, text);
    this.messages.appendChild(bubble);
    this.messages.scrollTop = this.messages.scrollHeight;
  }

  private showThinking(): void {
    if (this.thinkingEl) return;
    this.thinkingEl = el('div', { class: 'sc-thinking' }, 'thinking…');
    this.messages.appendChild(this.thinkingEl);
    this.messages.scrollTop = this.messages.scrollHeight;
  }

  private hideThinking(): void {
    if (this.thinkingEl) {
      this.thinkingEl.remove();
      this.thinkingEl = null;
    }
  }

  destroy(): void {
    if (this.ws) this.ws.close();
    this.root.remove();
  }
}

// ---------- Public API + auto-init ----------

interface PublicAPI {
  init(cfg: WidgetConfig): Widget;
  version: string;
}

const instances: Widget[] = [];

const api: PublicAPI = {
  init(cfg: WidgetConfig): Widget {
    const w = new Widget(cfg);
    instances.push(w);
    return w;
  },
  version: __SC_WIDGET_VERSION__,
};

(window as unknown as { SynapCores: PublicAPI }).SynapCores = api;

// Auto-init from <script data-backend="..." data-project="..."> attributes —
// the 1-line install path. Look up the *currently-executing* script tag.
function autoInit(): void {
  const scripts = Array.from(document.querySelectorAll('script[data-backend]'));
  for (const s of scripts) {
    const backend = s.getAttribute('data-backend');
    if (!backend) continue;
    api.init({
      backend,
      project: s.getAttribute('data-project') ?? undefined,
      agentName: s.getAttribute('data-agent-name') ?? undefined,
      greeting: s.getAttribute('data-greeting') ?? undefined,
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', autoInit);
} else {
  autoInit();
}
