/* The Widget — UI composition over visitor/ws/theme/markdown/bootstrap.
 *
 * Sprint 2 wire (gateway AiChatWsMessage, no Python middleware):
 *
 *   client → server:
 *     { type: "send_message", session_id, message, model?, context: {database} }
 *     { type: "ping" }
 *
 *   server → client:
 *     { type: "message_chunk", message_id, session_id, chunk }     (streaming)
 *     { type: "message_complete", message_id, session_id, full_message }
 *     { type: "tool_result", request_id, success, output, data?, error? }
 *     { type: "error", message, code }
 *     { type: "pong" }
 *
 * Responsibilities:
 *   - Bootstrap (POST /v1/widget/token) OR use manual token from config
 *   - Mount launcher + panel under .sc-widget-root
 *   - Open/close behaviour (click, ESC, header X)
 *   - Send composer + animated "thinking" dots
 *   - Stream chunks into an in-progress agent bubble
 *   - Markdown rendering for agent replies on complete
 *   - Connection-status banner (reconnecting…)
 *   - ARIA: role="dialog", aria-modal, focus trap, initial focus
 *   - Mobile: full-screen overlay below 480px (CSS-driven)
 */

import { bootstrapToken } from './bootstrap';
import { type FilledConfig, type WidgetConfig, deriveWsUrl, fillConfig } from './config';
import { el, trapFocus } from './dom';
import { renderMarkdown } from './markdown';
import { applyPosition, applyPrimaryColor, applyTheme } from './theme';
import { getVisitorId } from './visitor';
import { type WsClient, createWsClient } from './ws';

declare const __SC_WIDGET_VERSION__: string;
declare const __SC_WIDGET_CSS__: string;

type IncomingMsg =
  | { type: 'message_chunk'; message_id: string; session_id: string; chunk: string }
  | {
      type: 'message_complete';
      message_id: string;
      session_id: string;
      full_message?: { role?: string; content?: string };
    }
  | {
      type: 'tool_result';
      request_id: string;
      success: boolean;
      output: string;
      data?: unknown;
      error?: string;
    }
  | { type: 'error'; message: string; code?: string }
  | { type: 'pong' };

function newSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function injectStylesOnce(): void {
  if (document.getElementById('sc-widget-styles')) return;
  const style = document.createElement('style');
  style.id = 'sc-widget-styles';
  style.textContent = __SC_WIDGET_CSS__;
  document.head.appendChild(style);
}

function chatIcon(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', 'M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2z');
  svg.appendChild(path);
  return svg;
}

export class Widget {
  private cfg: FilledConfig;
  private visitor: string;
  private sessionId: string;
  private token: string;
  private ws: WsClient | null = null;
  private root: HTMLDivElement;
  private launcher: HTMLButtonElement;
  private panel: HTMLDivElement;
  private messages: HTMLDivElement;
  private input: HTMLInputElement;
  private sendBtn: HTMLButtonElement;
  private statusBanner: HTMLDivElement;
  private thinkingEl: HTMLElement | null = null;
  /** The agent bubble we're currently streaming chunks into. Cleared on complete. */
  private streamingBubble: HTMLDivElement | null = null;
  private streamingText = '';
  private releaseFocusTrap: (() => void) | null = null;
  private releaseTheme: (() => void) | null = null;
  private isOpen = false;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private titleId: string;

  constructor(cfg: WidgetConfig) {
    this.cfg = fillConfig(cfg);
    this.visitor = getVisitorId();
    this.sessionId = newSessionId();
    this.token = this.cfg.token;
    this.titleId = `sc-title-${Math.random().toString(36).slice(2, 8)}`;
    injectStylesOnce();

    // ---- root + theming ----
    this.root = el('div', { class: 'sc-widget-root', 'data-version': __SC_WIDGET_VERSION__ });
    applyPrimaryColor(this.root, this.cfg.primaryColor);
    applyPosition(this.root, this.cfg.position);
    this.releaseTheme = applyTheme(this.root, this.cfg.theme);

    // ---- launcher ----
    this.launcher = el(
      'button',
      { class: 'sc-launcher', 'aria-label': `Open chat with ${this.cfg.agentName}`, type: 'button' },
      chatIcon(),
    );
    this.launcher.addEventListener('click', () => this.toggle());

    // ---- panel ----
    this.panel = el('div', {
      class: 'sc-panel',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': this.titleId,
    });

    const title = el('span', { id: this.titleId, class: 'sc-title' }, this.cfg.agentName);
    const closeBtn = el(
      'button',
      { class: 'sc-header-close', 'aria-label': 'Close chat', type: 'button' },
      '×',
    );
    closeBtn.addEventListener('click', () => this.close());
    const header = el('div', { class: 'sc-header' }, title, closeBtn);

    this.statusBanner = el('div', { class: 'sc-status', role: 'status' });
    this.messages = el('div', {
      class: 'sc-messages',
      'aria-live': 'polite',
      'aria-atomic': 'false',
    });

    const form = el('form', { class: 'sc-composer' });
    this.input = el('input', {
      class: 'sc-input',
      type: 'text',
      placeholder: 'Type your message…',
      'aria-label': 'Message',
      autocomplete: 'off',
    }) as HTMLInputElement;
    this.sendBtn = el(
      'button',
      { class: 'sc-send', type: 'submit', 'aria-label': 'Send message' },
      'Send',
    ) as HTMLButtonElement;
    form.appendChild(this.input);
    form.appendChild(this.sendBtn);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.send(this.input.value);
    });

    this.panel.appendChild(header);
    this.panel.appendChild(this.statusBanner);
    this.panel.appendChild(this.messages);
    this.panel.appendChild(form);

    if (this.cfg.showBranding) {
      const footer = el(
        'div',
        { class: 'sc-footer' },
        el(
          'a',
          { href: 'https://synapcores.com', target: '_blank', rel: 'noopener noreferrer' },
          'Powered by SynapCores',
        ),
      );
      this.panel.appendChild(footer);
    }

    this.root.appendChild(this.launcher);
    this.root.appendChild(this.panel);
    document.body.appendChild(this.root);

    this.addBubble('agent', this.cfg.greeting);
  }

  // ---- public API ----

  open(): void {
    if (this.isOpen) return;
    this.panel.classList.add('sc-open');
    this.launcher.setAttribute('aria-expanded', 'true');
    this.isOpen = true;
    void this.ensureConnected();
    this.releaseFocusTrap = trapFocus(this.panel);
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.close();
      }
    };
    document.addEventListener('keydown', this.keyHandler);
    setTimeout(() => this.input.focus(), 50);
  }

  close(): void {
    if (!this.isOpen) return;
    this.panel.classList.remove('sc-open');
    this.launcher.setAttribute('aria-expanded', 'false');
    this.isOpen = false;
    if (this.releaseFocusTrap) {
      this.releaseFocusTrap();
      this.releaseFocusTrap = null;
    }
    if (this.keyHandler) {
      document.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    this.launcher.focus();
  }

  toggle(): void {
    this.isOpen ? this.close() : this.open();
  }

  send(text: string): void {
    const t = (text ?? '').trim();
    if (!t) return;
    if (!this.ws || this.ws.status() !== 'open') {
      this.addBubble('agent', '*(still connecting…)*');
      void this.ensureConnected();
      return;
    }
    this.addBubble('user', t);
    this.input.value = '';
    this.sendBtn.disabled = true;
    this.input.disabled = true;
    this.showThinking();
    const payload: Record<string, unknown> = {
      type: 'send_message',
      session_id: this.sessionId,
      message: t,
      context: { database: this.cfg.database, visitor_id: this.visitor },
    };
    if (this.cfg.model) payload.model = this.cfg.model;
    this.ws.send(payload);
  }

  destroy(): void {
    if (this.ws) this.ws.close();
    if (this.releaseFocusTrap) this.releaseFocusTrap();
    if (this.releaseTheme) this.releaseTheme();
    if (this.keyHandler) document.removeEventListener('keydown', this.keyHandler);
    this.root.remove();
  }

  // ---- internals ----

  private async ensureConnected(): Promise<void> {
    if (this.ws && this.ws.status() !== 'closed' && this.ws.status() !== 'error') return;

    if (!this.token) {
      this.onStatus('connecting');
      try {
        const resp = await bootstrapToken(this.cfg.apiBase, this.cfg.projectKey, this.visitor);
        this.token = resp.token;
      } catch (err) {
        this.statusBanner.textContent = `Auth failed — ${(err as Error).message}`;
        this.statusBanner.classList.add('sc-status-show');
        return;
      }
    }

    const wsUrl = deriveWsUrl(this.cfg.apiBase, this.token);
    this.ws = createWsClient({
      url: wsUrl,
      onMessage: (m) => this.onMessage(m as IncomingMsg),
      onStatus: (s) => this.onStatus(s),
    });
  }

  private onStatus(s: 'connecting' | 'open' | 'closed' | 'error'): void {
    this.statusBanner.classList.remove('sc-status-show');
    if (s === 'open') return;
    let label = '';
    if (s === 'connecting') label = 'Connecting…';
    else if (s === 'closed') label = 'Reconnecting…';
    else label = 'Connection error — retrying…';
    this.statusBanner.textContent = label;
    this.statusBanner.classList.add('sc-status-show');
  }

  private onMessage(msg: IncomingMsg): void {
    switch (msg.type) {
      case 'message_chunk':
        this.hideThinking();
        this.appendChunk(msg.chunk);
        break;
      case 'message_complete':
        this.hideThinking();
        this.finalizeStream(msg.full_message?.content);
        this.sendBtn.disabled = false;
        this.input.disabled = false;
        this.input.focus();
        break;
      case 'tool_result':
        // The chat-agent runs tools internally and the result lands in the
        // message_complete payload. If a separate tool_result frame arrives
        // (e.g. devs using execute_sql directly) we surface a compact
        // confirmation rather than dropping it silently.
        if (!msg.success) this.addBubble('agent', `*(tool error: ${msg.error ?? 'unknown'})*`);
        break;
      case 'error':
        this.hideThinking();
        this.finalizeStream();
        this.addBubble('agent', `*(error: ${msg.message})*`);
        this.sendBtn.disabled = false;
        this.input.disabled = false;
        break;
      case 'pong':
        break;
    }
  }

  private addBubble(from: 'user' | 'agent', text: string): HTMLDivElement {
    const cls = from === 'user' ? 'sc-bubble sc-bubble-user' : 'sc-bubble sc-bubble-agent';
    const bubble = el('div', { class: cls });
    if (from === 'agent') bubble.appendChild(renderMarkdown(text));
    else bubble.textContent = text;
    this.messages.appendChild(bubble);
    this.messages.scrollTop = this.messages.scrollHeight;
    return bubble;
  }

  private appendChunk(chunk: string): void {
    if (!this.streamingBubble) {
      this.streamingBubble = el('div', { class: 'sc-bubble sc-bubble-agent' });
      this.messages.appendChild(this.streamingBubble);
    }
    this.streamingText += chunk;
    // Streaming render: text-content while in-flight (cheap, no MD reflow per
    // chunk); on complete we re-render with full markdown.
    this.streamingBubble.textContent = this.streamingText;
    this.messages.scrollTop = this.messages.scrollHeight;
  }

  private finalizeStream(serverFull?: string): void {
    const finalText = serverFull ?? this.streamingText;
    if (this.streamingBubble) {
      this.streamingBubble.innerHTML = '';
      this.streamingBubble.appendChild(renderMarkdown(finalText));
      this.streamingBubble = null;
      this.streamingText = '';
    } else if (finalText) {
      // No chunks arrived (server didn't stream) — render the complete in one go.
      this.addBubble('agent', finalText);
    }
    this.messages.scrollTop = this.messages.scrollHeight;
  }

  private showThinking(): void {
    if (this.thinkingEl) return;
    const dots = el(
      'div',
      { class: 'sc-thinking', 'aria-label': `${this.cfg.agentName} is typing` },
      el('span', { class: 'sc-dot' }),
      el('span', { class: 'sc-dot' }),
      el('span', { class: 'sc-dot' }),
    );
    this.thinkingEl = dots;
    this.messages.appendChild(dots);
    this.messages.scrollTop = this.messages.scrollHeight;
  }

  private hideThinking(): void {
    if (this.thinkingEl) {
      this.thinkingEl.remove();
      this.thinkingEl = null;
    }
  }
}
