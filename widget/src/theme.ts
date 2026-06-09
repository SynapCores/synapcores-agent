/* Theme application — primary color, dark/light mode, position.
 *
 * Applied as inline CSS custom properties on the root .sc-widget-root element
 * so all child rules pick them up through `var(--sc-…)`. Pure-text helpers,
 * no DOM mutation lives here.
 */

import type { FilledConfig, Theme } from './config';

const POSITION_CLASS = {
  'bottom-right': 'sc-pos-br',
  'bottom-left': 'sc-pos-bl',
  'top-right': 'sc-pos-tr',
  'top-left': 'sc-pos-tl',
};

export function applyPosition(root: HTMLElement, position: FilledConfig['position']): void {
  for (const cls of Object.values(POSITION_CLASS)) root.classList.remove(cls);
  root.classList.add(POSITION_CLASS[position]);
}

export function applyPrimaryColor(root: HTMLElement, color: string): void {
  root.style.setProperty('--sc-primary', color);
}

function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'light' || theme === 'dark') return theme;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

/**
 * Apply the theme. When config theme is 'auto', wires a media-query listener
 * so a system-level dark/light flip propagates live. Returns a teardown.
 */
export function applyTheme(root: HTMLElement, theme: Theme): () => void {
  const setMode = (mode: 'light' | 'dark'): void => {
    root.classList.remove('sc-theme-light', 'sc-theme-dark');
    root.classList.add(mode === 'dark' ? 'sc-theme-dark' : 'sc-theme-light');
  };
  setMode(resolveTheme(theme));
  if (theme !== 'auto' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = (e: MediaQueryListEvent): void => setMode(e.matches ? 'dark' : 'light');
  // .addEventListener is supported by all our targets (ES2020 era browsers),
  // but Safari shipped it later than the others — guard for safety.
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }
  // Legacy Safari API.
  (mq as unknown as { addListener: (cb: (e: MediaQueryListEvent) => void) => void }).addListener(
    onChange,
  );
  return () => {
    (
      mq as unknown as { removeListener: (cb: (e: MediaQueryListEvent) => void) => void }
    ).removeListener(onChange);
  };
}
