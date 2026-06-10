/* Widget config — defaults, types, and data-* attribute parsing.
 *
 * Sprint 2 Phase B: widget talks to a Node.js proxy (not the SynapCores
 * gateway directly). The proxy holds the SynapCores credential; the
 * browser only holds an HttpOnly cookie issued by the proxy.
 *
 * Required surface for embedders:
 *   - apiBase   — proxy URL (e.g. https://chat.your.com)
 *   - projectKey— public project id (e.g. pk_abc123)
 *
 * The proxy controls everything else (database, persona, allowed origins,
 * rate limit, upstream credential).
 */

export type Position = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
export type Theme = 'light' | 'dark' | 'auto';

export interface WidgetConfig {
  /** Widget-proxy URL — e.g. https://chat.your.com or http://localhost:5060. */
  apiBase: string;
  /** Project public key — proxy looks up tenant/database/persona/allowed_origins. */
  projectKey: string;
  /** Header label override (proxy provides a default per project). */
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
  /** Optional model override — passed in send_message.model. */
  model?: string;
}

export type FilledConfig = Required<Omit<WidgetConfig, 'model' | 'agentName' | 'greeting'>> & {
  model: string;
  agentName: string;
  greeting: string;
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
  const projectKey = s.getAttribute('data-project-key');
  if (!apiBase || !projectKey) return null;
  const position = s.getAttribute('data-position') as Position | null;
  const theme = s.getAttribute('data-theme') as Theme | null;
  return {
    apiBase,
    projectKey,
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
  if (!cfg.projectKey) throw new Error('@synapcores/widget: `projectKey` is required');
  return {
    // If the page's <script> tag uses src="/widget.js" with the proxy as
    // origin, an empty data-api-base should resolve to the current origin.
    apiBase: cfg.apiBase.replace(/\/$/, '') || window.location.origin,
    projectKey: cfg.projectKey,
    agentName: cfg.agentName ?? DEFAULTS.agentName,
    greeting: cfg.greeting ?? DEFAULTS.greeting,
    primaryColor: cfg.primaryColor ?? DEFAULTS.primaryColor,
    position: cfg.position ?? DEFAULTS.position,
    theme: cfg.theme ?? DEFAULTS.theme,
    showBranding: cfg.showBranding ?? DEFAULTS.showBranding,
    model: cfg.model ?? '',
  };
}

/** Derive the WebSocket URL from the proxy apiBase: http→ws, https→wss, append /ws. */
export function deriveWsUrl(apiBase: string): string {
  const trimmed = apiBase.replace(/\/$/, '');
  const wsBase = trimmed.replace(/^http(s?):\/\//, (_m, s) => `ws${s}://`);
  return `${wsBase}/ws`;
}
