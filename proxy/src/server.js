/* @synapcores/widget-proxy — entry point.
 *
 * One Node process delivers the widget bundle, issues HttpOnly session
 * cookies, and proxies WS frames between the browser and a SynapCores
 * gateway whose credentials the proxy holds. The browser never holds a
 * SynapCores credential.
 *
 * Routes:
 *   GET  /widget.js          — static bundle (long-cache, ETag)
 *   GET  /health             — liveness
 *   POST /v1/session         — issue session cookie, returns {project, persona, agent_name}
 *   GET  /ws                 — upgrade (cookie-authenticated; proxies to upstream)
 *   OPTIONS *                — CORS preflight
 *
 * Run:
 *   PROXY_SESSION_SECRET=<≥32 chars> \
 *   PROXY_PROJECTS=./projects.json \
 *   node src/server.js
 */

import { createReadStream, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { loadConfig } from './config.js';
import { connectUpstream } from './upstream.js';
import { fetchHistory } from './upstream_rest.js';
import { take as takeRate } from './ratelimit.js';
import {
  deriveSessionId,
  makeSessionCookie,
  newVisitorId,
  verifySessionCookie,
} from './session.js';
import { getIdentity, setIdentity } from './identity.js';

const projectsPath = process.env.PROXY_PROJECTS ?? './projects.json';
const config = loadConfig(projectsPath);

// ---- widget bundle: read once at start, recompute ETag on disk mtime ----

let bundleCache = null;
function readBundle() {
  const stat = statSync(config.widget_bundle_path);
  if (bundleCache && bundleCache.mtimeMs === stat.mtimeMs) return bundleCache;
  // We don't load the whole file into memory — we stream it — but we DO
  // hash an mtime-based cache key for ETag/Last-Modified.
  const etag = createHash('sha256')
    .update(`${stat.size}:${stat.mtimeMs}`)
    .digest('hex')
    .slice(0, 16);
  bundleCache = { etag, mtimeMs: stat.mtimeMs, size: stat.size };
  return bundleCache;
}

// ---- helpers ----

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json',
    'content-length': Buffer.byteLength(data),
    ...headers,
  });
  res.end(data);
}

function originAllowed(origin, project) {
  return !!origin && project.allowed_origins.includes(origin);
}

function corsHeaders(origin, project) {
  if (!originAllowed(origin, project)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'vary': 'origin',
  };
}

async function readJson(req, limitBytes = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (c) => {
      total += c.length;
      if (total > limitBytes) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8') || 'null'));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// ---- HTTP server ----

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const origin = req.headers.origin || null;

  // OPTIONS preflight — answered against whichever project owns this origin,
  // if any. The session POST itself re-checks origin against the SPECIFIC
  // project_key submitted, so this preflight permissiveness is only enough
  // to let the browser send the real request.
  if (req.method === 'OPTIONS') {
    const project = origin
      ? Object.values(config.projects).find((p) => p.allowed_origins.includes(origin))
      : null;
    if (!project) return send(res, 403, 'origin not allowed');
    return send(res, 204, '', {
      ...corsHeaders(origin, project),
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '600',
    });
  }

  // -------- /health --------
  if (url.pathname === '/health') {
    return send(res, 200, { ok: true, projects: Object.keys(config.projects).length });
  }

  // -------- GET / — dev landing page --------
  // Embeds the widget against the FIRST configured project so localhost
  // dev is one curl-free step. Production embedders ignore this; they
  // paste the script tag on their own site.
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const firstKey = Object.keys(config.projects)[0];
    const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>@synapcores/widget — proxy dev page</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
       max-width:780px;margin:60px auto;padding:20px;color:#111;line-height:1.6;}
  h1{margin-top:0;} code{background:#f3f4f6;padding:1px 6px;border-radius:4px;}
  pre{background:#f3f4f6;padding:12px;border-radius:6px;overflow-x:auto;}
  .pill{display:inline-block;padding:2px 8px;border-radius:999px;background:#0ea5e9;color:#fff;
        font-size:.75em;font-weight:600;text-transform:uppercase;letter-spacing:.05em;}
</style></head><body>
<p><span class="pill">Sprint 2 Phase B — proxy</span></p>
<h1>@synapcores/widget — through the Node.js proxy</h1>
<p>The proxy holds the SynapCores credential. Your browser only holds an
<code>HttpOnly</code> signed cookie that names the visitor and project.
The widget bundle below is served from <code>/widget.js</code> on this
proxy, so embedding page and widget share an origin — the cookie travels
without any cross-origin SameSite gymnastics.</p>
<p>If the floating button is bottom-right and a message round-trips, the
whole pipeline works.</p>
<h3>Active project: <code>${firstKey}</code></h3>
<p>(First project in your <code>projects.json</code>. Edit that to add
more.)</p>
<script defer src="/widget.js"
  data-api-base="${''}${''}"
  data-project-key="${firstKey}"
  data-agent-name="SynapCores"
  data-greeting="Hi! I run through the proxy. The proxy holds the SynapCores credential — *you* never do."
  data-primary-color="#0ea5e9"
  data-position="bottom-right"
  data-theme="auto"></script>
</body></html>`;
    return send(res, 200, html, { 'content-type': 'text/html; charset=utf-8' });
  }

  // -------- /widget.js --------
  if (req.method === 'GET' && url.pathname === '/widget.js') {
    let info;
    try {
      info = readBundle();
    } catch (err) {
      return send(res, 500, `bundle not readable: ${err.message}`);
    }
    if (req.headers['if-none-match'] === info.etag) {
      res.writeHead(304, { etag: info.etag });
      return res.end();
    }
    res.writeHead(200, {
      'content-type': 'application/javascript; charset=utf-8',
      'content-length': info.size,
      'etag': info.etag,
      'cache-control': 'public, max-age=300, must-revalidate',
      'access-control-allow-origin': '*',
    });
    return createReadStream(config.widget_bundle_path).pipe(res);
  }

  // -------- POST /v1/session --------
  if (req.method === 'POST' && url.pathname === '/v1/session') {
    let body;
    try {
      body = await readJson(req);
    } catch (err) {
      return send(res, 400, `bad json: ${err.message}`);
    }
    const projectKey = body?.project_key;
    if (!projectKey || typeof projectKey !== 'string') {
      return send(res, 400, { error: 'project_key required' });
    }
    const project = config.projects[projectKey];
    if (!project) {
      return send(res, 404, { error: 'unknown project_key' });
    }
    if (!originAllowed(origin, project)) {
      return send(res, 403, { error: 'origin not in project allowlist' });
    }
    const visitorId = body?.visitor_id || newVisitorId();
    const cookie = makeSessionCookie({
      secret: config.session_secret,
      cookieName: config.cookie_name,
      ttlSeconds: config.session_ttl_seconds,
      visitorId,
      projectKey,
      sameSiteNone: config.same_site_none,
    });
    // Deterministic per-(visitor, project) chat session id — survives
    // proxy restart, no server-side state needed.
    const sessionId = deriveSessionId(config.session_secret, visitorId, projectKey);
    return send(
      res,
      200,
      {
        project_key: projectKey,
        persona: project.persona,
        agent_name: project.agent_name,
        database: project.database,
        visitor_id: visitorId,
        session_id: sessionId,
      },
      { 'set-cookie': cookie, ...corsHeaders(origin, project) },
    );
  }

  // -------- POST /v1/identify --------
  // Cookie-authenticated. Stores caller-supplied identity for the visitor;
  // the proxy injects it into context.user on subsequent send_message
  // frames so AGENT_RUN sees the visitor as identified instead of
  // anonymous. Payload is shallow-validated (string fields only); attrs
  // is forwarded verbatim with a size cap.
  if (req.method === 'POST' && url.pathname === '/v1/identify') {
    const session = verifySessionCookie(req.headers.cookie, {
      secret: config.session_secret,
      cookieName: config.cookie_name,
      ttlSeconds: config.session_ttl_seconds,
    });
    if (!session) return send(res, 401, { error: 'no session' });
    const project = config.projects[session.projectKey];
    if (!project || !originAllowed(origin, project)) {
      return send(res, 403, { error: 'origin not allowed' });
    }
    let body;
    try {
      body = await readJson(req, 8 * 1024);
    } catch (err) {
      return send(res, 400, `bad json: ${err.message}`);
    }
    const identity = {
      name: typeof body?.name === 'string' ? body.name.slice(0, 200) : undefined,
      email: typeof body?.email === 'string' ? body.email.slice(0, 320) : undefined,
      id: typeof body?.id === 'string' ? body.id.slice(0, 200) : undefined,
      attrs:
        body?.attrs && typeof body.attrs === 'object' && !Array.isArray(body.attrs)
          ? body.attrs
          : undefined,
    };
    setIdentity(session.visitorId, identity);
    return send(res, 200, { ok: true }, corsHeaders(origin, project));
  }

  // -------- GET /v1/history --------
  // Cookie-auth. Returns the last N messages for THIS visitor's deterministic
  // session_id (computed server-side — the visitor cannot read another
  // session's history). Backed by SynapCores's existing
  // GET /v1/chat/sessions/{id}/messages REST endpoint.
  if (req.method === 'GET' && url.pathname === '/v1/history') {
    const session = verifySessionCookie(req.headers.cookie, {
      secret: config.session_secret,
      cookieName: config.cookie_name,
      ttlSeconds: config.session_ttl_seconds,
    });
    if (!session) return send(res, 401, { error: 'no session' });
    const project = config.projects[session.projectKey];
    if (!project || !originAllowed(origin, project)) {
      return send(res, 403, { error: 'origin not allowed' });
    }
    const sessionId = deriveSessionId(
      config.session_secret,
      session.visitorId,
      session.projectKey,
    );
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 40), 100);
    const messages = await fetchHistory({
      apiBase: project.upstream_api_base,
      token: project.upstream_token,
      sessionId,
      pageSize: limit,
    });
    // Normalize to {role, content} so widget rendering is shape-stable
    // regardless of upstream schema drift.
    const turns = messages
      .map((m) => ({
        role: typeof m.role === 'string' ? m.role : 'user',
        content: typeof m.content === 'string' ? m.content : '',
      }))
      .filter((t) => t.content);
    return send(res, 200, { session_id: sessionId, turns }, corsHeaders(origin, project));
  }

  return send(res, 404, 'not found');
});

// ---- WebSocket /ws — cookie-authenticated proxy ----

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname !== '/ws') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }
  const session = verifySessionCookie(req.headers.cookie, {
    secret: config.session_secret,
    cookieName: config.cookie_name,
    ttlSeconds: config.session_ttl_seconds,
  });
  if (!session) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  const project = config.projects[session.projectKey];
  if (!project) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }
  // Origin re-check on upgrade. The session cookie alone wouldn't be sent
  // by a foreign origin under SameSite=Lax, but be belt-and-braces.
  const origin = req.headers.origin;
  if (origin && !project.allowed_origins.includes(origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    handleClient(ws, project, session);
  });
});

function handleClient(client, project, session) {
  const rateKey = `${project.key}:${session.visitorId}`;

  const upstream = connectUpstream({
    apiBase: project.upstream_api_base,
    token: project.upstream_token,
    onFrame: (data) => {
      if (client.readyState === client.OPEN) client.send(data);
    },
    onClose: () => {
      try {
        client.close();
      } catch {
        /* already closed */
      }
    },
    onError: (err) => {
      try {
        client.send(
          JSON.stringify({
            type: 'error',
            message: `upstream error: ${err.message}`,
            code: 'upstream',
          }),
        );
        client.close();
      } catch {
        /* ignore */
      }
    },
  });

  client.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return; // drop malformed
    }
    // Only allow chat verbs from browser. Block execute_sql / execute_tool
    // — even though the upstream JWT would authorize them, the widget
    // contract is "chat only". Block silently to keep the surface tiny.
    if (msg?.type !== 'send_message' && msg?.type !== 'ping') return;
    if (msg.type === 'send_message') {
      const { ok, retryInMs } = takeRate(rateKey, project.rate_limit_per_minute);
      if (!ok) {
        client.send(
          JSON.stringify({
            type: 'error',
            message: `rate limit (retry in ${Math.ceil(retryInMs / 1000)}s)`,
            code: 'rate_limit',
          }),
        );
        return;
      }
      // Server-controlled context. The proxy:
      //   - forces `database` to the project's config (no cross-tenant peek)
      //   - injects the cookie-derived visitor_id
      //   - forces `session_id` to the deterministic per-visitor value
      //     (the widget computes the same value, but never trust the
      //     client-supplied id — the proxy is the source of truth)
      //   - injects identity from /v1/identify, if any
      const identity = getIdentity(session.visitorId);
      msg.session_id = deriveSessionId(
        config.session_secret,
        session.visitorId,
        project.key,
      );
      msg.context = {
        ...(msg.context ?? {}),
        database: project.database,
        visitor_id: session.visitorId,
        ...(identity ? { user: identity } : {}),
      };
    }
    upstream.send(msg);
  });

  client.on('close', () => upstream.close());
  client.on('error', () => upstream.close());
}

server.listen(config.port, config.host, () => {
  const projectKeys = Object.keys(config.projects).join(', ');
  // eslint-disable-next-line no-console
  console.log(
    `[widget-proxy] listening on ${config.host}:${config.port}  projects=${projectKeys}  bundle=${config.widget_bundle_path}`,
  );
});

// Graceful shutdown so `node --watch` doesn't leak.
process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
