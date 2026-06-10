/* Load + validate projects.json.
 *
 * Project config holds: tenant, database, persona, allowed_origins,
 * rate limit, and the upstream SynapCores credential. Credentials can be
 * inlined OR referenced via `ENV:NAME` so projects.json can be committed
 * without leaking secrets.
 *
 * No external schema lib — validation is hand-written; surface is small.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * @typedef {Object} ProjectConfig
 * @property {string} key                   — pk_… project key (also the JSON key)
 * @property {string} tenant                — SynapCores tenant id
 * @property {string} database              — SynapCores database name
 * @property {string} persona               — chat-agent persona
 * @property {string} agent_name            — display name in widget header
 * @property {string[]} allowed_origins     — CORS allowlist (must include port + scheme)
 * @property {number} rate_limit_per_minute — visitor turn cap
 * @property {string} upstream_api_base     — e.g. http://localhost:8080
 * @property {string} upstream_token        — JWT or API key (resolved from ENV: refs)
 */

/**
 * @typedef {Object} ProxyConfig
 * @property {Object<string, ProjectConfig>} projects
 * @property {string} session_secret       — HMAC secret for cookies (from env)
 * @property {number} session_ttl_seconds  — cookie TTL
 * @property {string} cookie_name
 * @property {number} port
 * @property {string} host
 * @property {string} widget_bundle_path   — absolute path to widget.js (served at /widget.js)
 */

/** Resolve ENV: prefixes against process.env; otherwise pass through. */
function resolveEnvRef(value) {
  if (typeof value !== 'string') return value;
  if (!value.startsWith('ENV:')) return value;
  const name = value.slice(4);
  const v = process.env[name];
  if (!v) throw new Error(`projects.json references env var ${name} but it's not set`);
  return v;
}

/**
 * @param {string} configPath
 * @returns {ProxyConfig}
 */
export function loadConfig(configPath) {
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  const session_secret =
    process.env.PROXY_SESSION_SECRET ||
    (raw.session?.secret_env && process.env[raw.session.secret_env]);
  if (!session_secret) {
    throw new Error(
      'PROXY_SESSION_SECRET env var required (or set session.secret_env in projects.json)',
    );
  }
  if (session_secret.length < 32) {
    throw new Error('PROXY_SESSION_SECRET must be ≥ 32 chars');
  }

  const projects = {};
  for (const [key, p] of Object.entries(raw.projects ?? {})) {
    if (!key.startsWith('pk_')) {
      throw new Error(`project key "${key}" must start with pk_`);
    }
    if (!p.tenant || !p.database || !p.upstream?.api_base) {
      throw new Error(
        `project "${key}" missing required field (tenant, database, or upstream.api_base)`,
      );
    }
    if (!Array.isArray(p.allowed_origins) || p.allowed_origins.length === 0) {
      throw new Error(`project "${key}" must have a non-empty allowed_origins array`);
    }
    projects[key] = {
      key,
      tenant: p.tenant,
      database: p.database,
      persona: p.persona ?? 'support',
      agent_name: p.agent_name ?? 'Support',
      allowed_origins: p.allowed_origins,
      rate_limit_per_minute: Number(p.rate_limit_per_minute ?? 60),
      upstream_api_base: p.upstream.api_base.replace(/\/$/, ''),
      upstream_token: resolveEnvRef(p.upstream.token ?? ''),
    };
    if (!projects[key].upstream_token) {
      throw new Error(`project "${key}" missing upstream.token (raw or ENV: ref)`);
    }
  }

  if (Object.keys(projects).length === 0) {
    throw new Error('projects.json defines zero projects');
  }

  return {
    projects,
    session_secret,
    session_ttl_seconds: Number(raw.session?.ttl_seconds ?? 3600),
    cookie_name: raw.session?.cookie_name ?? 'sc_session',
    port: Number(process.env.PORT ?? raw.server?.port ?? 5060),
    host: process.env.HOST ?? raw.server?.host ?? '0.0.0.0',
    // Resolve relative paths against the projects.json directory, NOT
    // process.cwd() — the proxy is often started from a different cwd.
    widget_bundle_path: (() => {
      const v =
        process.env.WIDGET_BUNDLE_PATH ??
        raw.server?.widget_bundle_path ??
        path.join('..', 'widget', 'dist', 'widget.js');
      return path.isAbsolute(v) ? v : path.resolve(path.dirname(configPath), v);
    })(),
    /** Set true to use SameSite=None+Secure (cross-origin prod embed). Default false (Lax). */
    same_site_none: !!raw.session?.same_site_none,
  };
}
