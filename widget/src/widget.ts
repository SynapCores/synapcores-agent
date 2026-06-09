/* The Widget — UI composition over visitor/ws/theme/markdown.
 *
 * Responsibilities:
 *   - Mount the launcher + panel under .sc-widget-root
 *   - Open/close behaviour (click, ESC, header X)
 *   - Send composer + animated "thinking" dots
 *   - Markdown rendering for agent replies
 *   - Connection-status banner (reconnecting…)
 *   - ARIA: role="dialog", aria-modal, focus trap, initial focus
 *   - Mobile: full-screen overlay below 480px (CSS-driven)
 *
 * Stays pure DOM — no framework. ~250 lines is the budget.
 */

import { type FilledConfig, type WidgetConfig, fillConfig } from './config';
import { el, trapFocus } from './dom';
import { renderMarkdown } from './markdown';
import { applyPosition, applyPrimaryColor, applyTheme } from './theme';
import { getVisitorId } from './visitor';
import { type WsClient, createWsClient } from './ws';

declare const __SC_WIDGET_VERSION__: string;
declare const __SC_WIDGET_CSS__: string;

type IncomingMsg =
  | { type: 'thinking' }
  | { type: 'brain'; [k: string]: unknown }
  | { type: 'reply'; text: string };

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
  private ws: WsClient | null = null;
  private root: HTMLDivElement;
  private launcher: HTMLButtonElement;
  private panel: HTMLDivElement;
  private messages: HTMLDivElement;
  private input: HTMLInputElement;
  private sendBtn: HTMLButtonElement;
  private statusBanner: HTMLDivElement;
  private thinkingEl: HTMLElement | null = null;
  private releaseFocusTrap: (() => void) | null = null;
  private releaseTheme: (() => void) | null = null;
  private isOpen = false;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private titleId: string;

  constructor(cfg: WidgetConfig) {
    this.cfg = fillConfig(cfg);
    this.visitor = getVisitorId();
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

    // header
    const title = el('span', { id: this.titleId, class: 'sc-title' }, this.cfg.agentName);
    const closeBtn = el('button', { class: 'sc-header-close', 'aria-label': 'Close chat', type: 'button' }, '×');
    closeBtn.addEventListener('click', () => this.close());
    const header = el('div', { class: 'sc-header' }, title, closeBtn);

    // status banner — hidden by default
    this.statusBanner = el('div', { class: 'sc-status', role: 'status' });

    // messages
    this.messages = el('div', { class: 'sc-messages', 'aria-live': 'polite', 'aria-atomic': 'false' });

    // composer
    const form = el('form', { class: 'sc-composer' });
    this.input = el('input', {
      class: 'sc-input',
      type: 'text',
      placeholder: 'Type your message…',
      'aria-label': 'Message',
      autocomplete: 'off',
    }) as HTMLInputElement;
    this.sendBtn = el('button', { class: 'sc-send', type: 'submit', 'aria-label': 'Send message' }, 'Send') as HTMLButtonElement;
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
    this.ensureConnected();
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
      this.ensureConnected();
      return;
    }
    this.addBubble('user', t);
    this.input.value = '';
    this.sendBtn.disabled = true;
    this.input.disabled = true;
    this.ws.send({ type: 'turn', user_id: this.visitor, text: t });
  }

  destroy(): void {
    if (this.ws) this.ws.close();
    if (this.releaseFocusTrap) this.releaseFocusTrap();
    if (this.releaseTheme) this.releaseTheme();
    if (this.keyHandler) document.removeEventListener('keydown', this.keyHandler);
    this.root.remove();
  }

  // ---- internals ----

  private ensureConnected(): void {
    if (this.ws && this.ws.status() !== 'closed') return;
    this.ws = createWsClient({
      url: this.cfg.backend,
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
      case 'thinking':
        this.showThinking();
        break;
      case 'brain':
        // Sprint 2+ wires this to a debug surface; spike + MVP ignore.
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

  private addBubble(from: 'user' | 'agent', text: string): void {
    const cls = from === 'user' ? 'sc-bubble sc-bubble-user' : 'sc-bubble sc-bubble-agent';
    const bubble = el('div', { class: cls });
    if (from === 'agent') {
      bubble.appendChild(renderMarkdown(text));
    } else {
      // User input is plain text — no markdown interpretation.
      bubble.textContent = text;
    }
    this.messages.appendChild(bubble);
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
