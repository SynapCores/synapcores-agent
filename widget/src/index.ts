/* @synapcores/widget — public entry.
 *
 * Exposes window.SynapCores.{init, version} and auto-inits from
 * <script data-backend="..." data-*="..."> attributes. Sprint 1 MVP — UI
 * polish lives in widget.ts, this file is intentionally tiny so the public
 * API surface stays a single screen and we don't break embedders on minor
 * UI changes.
 */

import { type WidgetConfig, readConfigFromScript } from './config';
import type { IdentifyAttrs } from './session';
import { Widget } from './widget';

declare const __SC_WIDGET_VERSION__: string;

interface PublicAPI {
  init(cfg: WidgetConfig): Widget;
  /** Identify the visitor on EVERY current Widget instance. Convenience for
   *  the common case where a host site has one widget on the page. */
  identify(attrs: IdentifyAttrs): void;
  version: string;
}

const instances: Widget[] = [];

const api: PublicAPI = {
  init(cfg: WidgetConfig): Widget {
    const w = new Widget(cfg);
    instances.push(w);
    return w;
  },
  identify(attrs: IdentifyAttrs): void {
    for (const w of instances) w.identify(attrs);
  },
  version: __SC_WIDGET_VERSION__,
};

(window as unknown as { SynapCores: PublicAPI }).SynapCores = api;

function autoInit(): void {
  const scripts = Array.from(document.querySelectorAll('script[data-backend]'));
  for (const s of scripts) {
    const cfg = readConfigFromScript(s);
    if (cfg) api.init(cfg);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', autoInit);
} else {
  autoInit();
}
