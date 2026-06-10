/* Widget config — defaults, types, data-* attribute parsing.
 *
 * Sprint 2 pivot: the widget talks DIRECTLY to the SynapCores gateway's
 * /ws endpoint (AiChatWsMessage protocol). No Python middleware. The
 * gateway requires a JWT — for production embedders the widget bootstraps
 * a short-lived visitor token via POST /v1/widget/token (Sprint 2 gateway
 * work, separate ticket). For development you can paste a manually-
 * obtained admin/user JWT via `data-token`.
 */

export type Position = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
export type Theme = 'light' | 'dark' | 'auto';

export interface WidgetConfig {
  /** SynapCores gateway base URL — e.g. http://localhost:8080 or https://api.your.com.
   *  WS URL is derived from this (http→ws, https→wss) + "/ws". */
  apiBase: string;
  /** Project public key — passed to /v1/widget/token to look up tenant,
   *  persona, CORS allowlist, rate limit. Required unless `token` is set
   *  directly (dev bypass). */
  projectKey?: string;
  /** SynapCores database to chat against. Required. */
  database: string;
  /** Pre-issued JWT — bypasses /v1/widget/token bootstrap. Dev / admin use only;
   *  do NOT use in production embed code (browser-visible secret). */
  token?: string;
  /** Header label. */
  agentName?: string;
  /** First message shown when the panel opens. */
  greeting?: string;
  /** Primary brand color. Default '#00bfff'. */
  primaryColor?: string;
  /** Launcher corner. Default 'bottom-right'. */
  position?: Position;
  /** Light/dark/auto. Default 'auto'. */
  theme?: Theme;
  /** Show "Powered by SynapCores" footer. Default true. */
  showBranding?: boolean;
  /** Optional model override for the chat — passed in send_message.model. */
  model?: string;
}

export type FilledConfig = Required<Omit<WidgetConfig, 'projectKey' | 'token' | 'model'>> & {
  projectKey: string;
  token: string;
  model: string;
};

export const DEFAULTS = {
  agentName: 'Support',
  greeting: 'Hi! How can I help?',
  primaryColor: '#00bfff',
  position: 'bottom-right' as Position,
  theme: 'auto' as Theme,
  showBranding: true,
};

const VALID_POSITIONS: Position[] = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
const VALID_THEMES: Theme[] = ['light', 'dark', 'auto'];

function coerceBool(v: string | null | undefined, fallback: boolean): boolean {
  if (v == null) return fallback;
  const s = v.toLowerCase().trim();
  if (s === 'false' || s === '0' || s === 'no') return false;
  if (s === 'true' || s === '1' || s === 'yes' || s === '') return true;
  return fallback;
}

export function readConfigFromScript(s: Element): WidgetConfig | null {
  const apiBase = s.getAttribute('data-api-base');
  const database = s.getAttribute('data-database');
  if (!apiBase || !database) return null;
  const position = s.getAttribute('data-position') as Position | null;
  const theme = s.getAttribute('data-theme') as Theme | null;
  return {
    apiBase,
    database,
    projectKey: s.getAttribute('data-project-key') ?? undefined,
    token: s.getAttribute('data-token') ?? undefined,
    agentName: s.getAttribute('data-agent-name') ?? undefined,
    greeting: s.getAttribute('data-greeting') ?? undefined,
    primaryColor: s.getAttribute('data-primary-color') ?? undefined,
    position: position && VALID_POSITIONS.includes(position) ? position : undefined,
    theme: theme && VALID_THEMES.includes(theme) ? theme : undefined,
    showBranding: s.hasAttribute('data-show-branding')
      ? coerceBool(s.getAttribute('data-show-branding'), DEFAULTS.showBranding)
      : undefined,
    model: s.getAttribute('data-model') ?? undefined,
  };
}

export function fillConfig(cfg: WidgetConfig): FilledConfig {
  if (!cfg.apiBase) throw new Error('@synapcores/widget: `apiBase` is required');
  if (!cfg.database) throw new Error('@synapcores/widget: `database` is required');
  if (!cfg.projectKey && !cfg.token) {
    throw new Error(
      '@synapcores/widget: either `projectKey` (for production bootstrap) or `token` (for dev) is required',
    );
  }
  return {
    apiBase: cfg.apiBase.replace(/\/$/, ''),
    projectKey: cfg.projectKey ?? '',
    database: cfg.database,
    token: cfg.token ?? '',
    agentName: cfg.agentName ?? DEFAULTS.agentName,
    greeting: cfg.greeting ?? DEFAULTS.greeting,
    primaryColor: cfg.primaryColor ?? DEFAULTS.primaryColor,
    position: cfg.position ?? DEFAULTS.position,
    theme: cfg.theme ?? DEFAULTS.theme,
    showBranding: cfg.showBranding ?? DEFAULTS.showBranding,
    model: cfg.model ?? '',
  };
}

/** Derive the WebSocket URL from the apiBase: http→ws, https→wss, append /ws. */
export function deriveWsUrl(apiBase: string, token: string): string {
  const trimmed = apiBase.replace(/\/$/, '');
  const wsBase = trimmed.replace(/^http(s?):\/\//, (_m, s) => `ws${s}://`);
  return `${wsBase}/ws?token=${encodeURIComponent(token)}`;
}
