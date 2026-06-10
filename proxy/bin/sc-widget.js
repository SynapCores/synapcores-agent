#!/usr/bin/env node
/* sc-widget — tiny CLI for the widget proxy.
 *
 *   sc-widget projects ls                — list projects
 *   sc-widget embed <project-key>        — print the embed snippet
 *   sc-widget verify-config              — load projects.json + report
 *
 * Reads PROXY_PROJECTS the same way the server does. Useful for ops
 * smoke-checks without curling the running proxy.
 */

import { loadConfig } from '../src/config.js';

const cmd = process.argv[2];
const arg = process.argv[3];
const configPath = process.env.PROXY_PROJECTS ?? './projects.json';

function help() {
  console.log(`sc-widget — proxy ops helper
usage:
  sc-widget projects ls
  sc-widget embed <project-key> [--public-host=https://chat.your.com]
  sc-widget verify-config

env:
  PROXY_PROJECTS         path to projects.json (default ./projects.json)
  PROXY_SESSION_SECRET   required (32+ chars)`);
}

let config;
try {
  config = loadConfig(configPath);
} catch (err) {
  console.error(`config error: ${err.message}`);
  process.exit(2);
}

switch (cmd) {
  case 'projects': {
    if (arg !== 'ls') {
      help();
      process.exit(1);
    }
    const rows = Object.values(config.projects).map((p) => ({
      key: p.key,
      tenant: p.tenant,
      database: p.database,
      persona: p.persona,
      origins: p.allowed_origins.length,
      rl_per_min: p.rate_limit_per_minute,
    }));
    console.table(rows);
    break;
  }
  case 'embed': {
    if (!arg || !config.projects[arg]) {
      console.error(`unknown project_key: ${arg}`);
      console.error(`known: ${Object.keys(config.projects).join(', ')}`);
      process.exit(1);
    }
    const publicHostFlag = process.argv.find((a) => a.startsWith('--public-host='));
    const publicHost = publicHostFlag
      ? publicHostFlag.split('=')[1]
      : `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
    console.log(`<script defer
  src="${publicHost}/widget.js"
  data-api-base="${publicHost}"
  data-project-key="${arg}"></script>`);
    break;
  }
  case 'verify-config': {
    console.log(`projects.json OK  (${Object.keys(config.projects).length} project(s))`);
    for (const p of Object.values(config.projects)) {
      console.log(`  ${p.key}  → ${p.upstream_api_base}  db=${p.database}  origins=[${p.allowed_origins.join(', ')}]`);
    }
    break;
  }
  default:
    help();
    process.exit(cmd ? 1 : 0);
}
