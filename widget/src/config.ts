/* Widget config — defaults, types, and data-* attribute parsing.
 * Single source of truth: anything user-tweakable is defined here, so the
 * Widget class only knows about Required<WidgetConfig> with everything filled
 * in.
 */

export type Position = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
export type Theme = 'light' | 'dark' | 'auto';

export interface WidgetConfig {
  /** WebSocket URL of the synapcores-agent backend. e.g. ws://localhost:8810/ws */
  backend: string;
  /** Project id — passed through but ignored by the v1 backend; Sprint 2 wires it. */
  project?: string;
  /** Header label. */
  agentName?: string;
  /** First message shown when the panel opens. */
  greeting?: string;
  /** Primary brand color (CSS color string). Default '#00bfff'. */
  primaryColor?: string;
  /** Where on the screen the launcher sits. Default 'bottom-right'. */
  position?: Position;
  /** Light/dark/auto. Default 'auto' (follows prefers-color-scheme). */
  theme?: Theme;
  /** Show the "Powered by SynapCores" footer. Default true (OSS convention). */
  showBranding?: boolean;
}

export type FilledConfig = Required<WidgetConfig>;

export const DEFAULTS: Omit<FilledConfig, 'backend'> = {
  project: '',
  agentName: 'Support',
  greeting: 'Hi! How can I help?',
  primaryColor: '#00bfff',
  position: 'bottom-right',
  theme: 'auto',
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
  const backend = s.getAttribute('data-backend');
  if (!backend) return null;
  const position = s.getAttribute('data-position') as Position | null;
  const theme = s.getAttribute('data-theme') as Theme | null;
  return {
    backend,
    project: s.getAttribute('data-project') ?? undefined,
    agentName: s.getAttribute('data-agent-name') ?? undefined,
    greeting: s.getAttribute('data-greeting') ?? undefined,
    primaryColor: s.getAttribute('data-primary-color') ?? undefined,
    position: position && VALID_POSITIONS.includes(position) ? position : undefined,
    theme: theme && VALID_THEMES.includes(theme) ? theme : undefined,
    showBranding: s.hasAttribute('data-show-branding')
      ? coerceBool(s.getAttribute('data-show-branding'), DEFAULTS.showBranding)
      : undefined,
  };
}

export function fillConfig(cfg: WidgetConfig): FilledConfig {
  if (!cfg.backend) throw new Error('@synapcores/widget: `backend` is required');
  return {
    backend: cfg.backend,
    project: cfg.project ?? DEFAULTS.project,
    agentName: cfg.agentName ?? DEFAULTS.agentName,
    greeting: cfg.greeting ?? DEFAULTS.greeting,
    primaryColor: cfg.primaryColor ?? DEFAULTS.primaryColor,
    position: cfg.position ?? DEFAULTS.position,
    theme: cfg.theme ?? DEFAULTS.theme,
    showBranding: cfg.showBranding ?? DEFAULTS.showBranding,
  };
}
