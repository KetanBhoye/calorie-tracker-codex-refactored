#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i];
    if (!part.startsWith('--')) {
      continue;
    }

    const key = part.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = 'true';
      continue;
    }

    args[key] = next;
    i += 1;
  }

  return args;
}

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  applySetCookie(headers) {
    const all = [];

    if (typeof headers.getSetCookie === 'function') {
      all.push(...headers.getSetCookie());
    }

    const single = headers.get('set-cookie');
    if (single && all.length === 0) {
      all.push(single);
    }

    for (const value of all) {
      const cookiePair = value.split(';', 1)[0];
      const index = cookiePair.indexOf('=');
      if (index <= 0) {
        continue;
      }

      const name = cookiePair.slice(0, index).trim();
      const cookieValue = cookiePair.slice(index + 1).trim();
      this.cookies.set(name, cookieValue);
    }
  }

  toHeaderValue() {
    if (this.cookies.size === 0) {
      return undefined;
    }

    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }
}

function normalizeBaseUrl(url) {
  return url.replace(/\/$/, '');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseJsonOrSse(text) {
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    // Continue to SSE parsing.
  }

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith('data:')) {
      continue;
    }

    const payload = line.slice('data:'.length).trim();
    if (!payload) {
      continue;
    }

    try {
      return JSON.parse(payload);
    } catch {
      // Continue scanning.
    }
  }

  return undefined;
}

function info(message) {
  process.stdout.write(`${message}\n`);
}

const args = parseArgs(process.argv.slice(2));

const baseUrl = normalizeBaseUrl(args['base-url'] || process.env.BASE_URL || 'http://127.0.0.1:8787');
const publicBaseUrl = args['public-base-url']
  ? normalizeBaseUrl(args['public-base-url'])
  : undefined;

const adminApiKey = args['admin-api-key'] || process.env.ADMIN_API_KEY;
const adminEmail = args['admin-email'] || process.env.ADMIN_EMAIL;
const adminPassword = args['admin-password'] || process.env.ADMIN_PASSWORD;
const composeProjectDir = args['compose-project-dir'];
const serviceName = args['service-name'] || 'calorie-tracker-mcp';

if (!adminApiKey) {
  throw new Error('Missing --admin-api-key or ADMIN_API_KEY');
}

if (!adminEmail || !adminPassword) {
  throw new Error('Missing --admin-email/--admin-password or ADMIN_EMAIL/ADMIN_PASSWORD');
}

async function request(base, path, options = {}) {
  const url = path.startsWith('http://') || path.startsWith('https://')
    ? path
    : `${base}${path}`;

  const headers = new Headers(options.headers || {});
  if (options.cookieJar) {
    const cookie = options.cookieJar.toHeaderValue();
    if (cookie) {
      headers.set('cookie', cookie);
    }
  }

  let body;
  if (options.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(options.json);
  } else if (options.body !== undefined) {
    body = options.body;
  }

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body,
    redirect: options.redirect || 'follow',
    signal: AbortSignal.timeout(options.timeoutMs || 15000),
  });

  if (options.cookieJar) {
    options.cookieJar.applySetCookie(response.headers);
  }

  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }

  return {
    response,
    status: response.status,
    headers: response.headers,
    text,
    json,
  };
}

async function expectStatus(base, path, expectedStatus) {
  const res = await request(base, path);
  assert(
    res.status === expectedStatus,
    `${path} expected ${expectedStatus}, got ${res.status}: ${res.text}`
  );
  return res;
}

async function waitForHealthy(base, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await request(base, '/health', { timeoutMs: 5000 });
      if (res.status === 200 && res.json?.status === 'ok') {
        return;
      }
    } catch {
      // Service may still be booting after restart.
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error(`Service did not become healthy at ${base}/health within ${timeoutMs}ms`);
}

function restartContainerIfConfigured() {
  if (!composeProjectDir) {
    info('Skipping container restart check (no --compose-project-dir provided).');
    return false;
  }

  info(`Restarting container via docker compose (${serviceName})...`);
  execFileSync(
    'docker',
    ['compose', '--project-directory', composeProjectDir, 'restart', serviceName],
    { stdio: 'inherit' }
  );
  return true;
}

async function checkPublicPaths(targetBase, label) {
  info(`Checking ${label} endpoints on ${targetBase}`);

  const health = await expectStatus(targetBase, '/health', 200);
  assert(health.json?.status === 'ok', `${label} /health payload missing status=ok`);

  await expectStatus(targetBase, '/.well-known/oauth-authorization-server', 200);
  await expectStatus(targetBase, '/.well-known/oauth-protected-resource', 200);
  await expectStatus(targetBase, '/signup', 200);
  await expectStatus(targetBase, '/login', 200);
  await expectStatus(targetBase, '/dashboard', 200);
}

async function run() {
  info(`Running acceptance tests against ${baseUrl}`);
  await checkPublicPaths(baseUrl, 'local');

  if (publicBaseUrl) {
    await checkPublicPaths(publicBaseUrl, 'public');
  }

  const userJar = new CookieJar();
  const suffix = randomUUID().slice(0, 8);
  const testUser = {
    name: 'Deployment Smoke User',
    email: `deploy-${suffix}@example.com`,
    password: `Pass!${suffix}1234`,
  };

  info('Creating test user and entry (persistence pre-check)...');
  let signup = await request(baseUrl, '/api/auth/signup', {
    method: 'POST',
    cookieJar: userJar,
    json: testUser,
  });

  if (signup.status === 409) {
    signup = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      cookieJar: userJar,
      json: {
        email: testUser.email,
        password: testUser.password,
      },
    });
  }

  assert(
    signup.status === 201 || signup.status === 200,
    `User signup/login failed: ${signup.status} ${signup.text}`
  );

  const today = new Date().toISOString().slice(0, 10);
  const marker = `Persistence-${suffix}`;
  const createEntry = await request(baseUrl, '/api/entries', {
    method: 'POST',
    cookieJar: userJar,
    json: {
      food_name: marker,
      calories: 345,
      protein_g: 20,
      carbs_g: 33,
      fat_g: 10,
      meal_type: 'lunch',
      entry_date: today,
    },
  });

  assert(createEntry.status === 201, `Create entry failed: ${createEntry.status} ${createEntry.text}`);
  const entryId = createEntry.json?.entry_id;
  assert(typeof entryId === 'string' && entryId.length > 0, 'Entry id missing from create response');

  const beforeRestart = await request(baseUrl, `/api/entries?date=${today}`, {
    method: 'GET',
    cookieJar: userJar,
  });
  assert(beforeRestart.status === 200, `List entries before restart failed: ${beforeRestart.status}`);
  assert(
    Array.isArray(beforeRestart.json?.entries) &&
      beforeRestart.json.entries.some((entry) => entry.id === entryId),
    'Created entry not found before restart'
  );

  if (restartContainerIfConfigured()) {
    await waitForHealthy(baseUrl);

    const reloginJar = new CookieJar();
    const relogin = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      cookieJar: reloginJar,
      json: {
        email: testUser.email,
        password: testUser.password,
      },
    });

    assert(relogin.status === 200, `Relogin failed after restart: ${relogin.status} ${relogin.text}`);

    const afterRestart = await request(baseUrl, `/api/entries?date=${today}`, {
      method: 'GET',
      cookieJar: reloginJar,
    });

    assert(
      afterRestart.status === 200,
      `List entries after restart failed: ${afterRestart.status} ${afterRestart.text}`
    );

    assert(
      Array.isArray(afterRestart.json?.entries) &&
        afterRestart.json.entries.some((entry) => entry.id === entryId),
      'Created entry did not persist after container restart'
    );

    info('Persistence check passed after container restart.');
  }

  info('Running OAuth authorization code flow...');
  const redirectUri = 'http://127.0.0.1/oauth-callback';
  const registerClient = await request(baseUrl, '/oauth/register', {
    method: 'POST',
    headers: {
      'x-api-key': adminApiKey,
    },
    json: {
      client_name: `Acceptance Client ${suffix}`,
      redirect_uris: [redirectUri],
      user_id: 'admin',
      scope: 'mcp:tools',
    },
  });

  assert(
    registerClient.status === 201,
    `OAuth client registration failed: ${registerClient.status} ${registerClient.text}`
  );

  const clientId = registerClient.json?.client_id;
  const clientSecret = registerClient.json?.client_secret;
  assert(clientId && clientSecret, 'OAuth register response missing client credentials');

  const adminJar = new CookieJar();
  const adminLogin = await request(baseUrl, '/api/auth/login', {
    method: 'POST',
    cookieJar: adminJar,
    json: {
      email: adminEmail,
      password: adminPassword,
    },
  });
  assert(adminLogin.status === 200, `Admin login failed: ${adminLogin.status} ${adminLogin.text}`);

  const authorizeUrl = new URL('/oauth/authorize', baseUrl);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('scope', 'mcp:tools');
  authorizeUrl.searchParams.set('state', `state-${suffix}`);

  const authorizeResponse = await request(baseUrl, authorizeUrl.toString(), {
    method: 'GET',
    cookieJar: adminJar,
    redirect: 'manual',
  });

  assert(
    authorizeResponse.status === 302 || authorizeResponse.status === 303,
    `OAuth authorize did not redirect: ${authorizeResponse.status} ${authorizeResponse.text}`
  );

  const location = authorizeResponse.headers.get('location');
  assert(location, 'OAuth authorize missing redirect location');

  const callbackUrl = new URL(location);
  const authCode = callbackUrl.searchParams.get('code');
  assert(authCode, `OAuth callback missing code: ${location}`);

  const tokenResponse = await request(baseUrl, '/oauth/token', {
    method: 'POST',
    json: {
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code: authCode,
      redirect_uri: redirectUri,
    },
  });

  assert(tokenResponse.status === 200, `Token exchange failed: ${tokenResponse.status} ${tokenResponse.text}`);
  const accessToken = tokenResponse.json?.access_token;
  assert(accessToken, 'Token response missing access_token');

  info('Testing MCP initialize + tools/list with OAuth token...');
  const initializeResponse = await request(baseUrl, '/mcp', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json, text/event-stream',
    },
    json: {
      jsonrpc: '2.0',
      id: 'init-1',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'deployment-acceptance-test',
          version: '1.0.0',
        },
      },
    },
  });

  assert(
    initializeResponse.status === 200,
    `MCP initialize failed: ${initializeResponse.status} ${initializeResponse.text}`
  );

  const sessionId = initializeResponse.headers.get('mcp-session-id');
  assert(sessionId, 'MCP initialize missing mcp-session-id response header');

  const toolsListResponse = await request(baseUrl, '/mcp', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
    },
    json: {
      jsonrpc: '2.0',
      id: 'tools-1',
      method: 'tools/list',
      params: {},
    },
  });

  assert(
    toolsListResponse.status === 200,
    `MCP tools/list failed: ${toolsListResponse.status} ${toolsListResponse.text}`
  );

  const toolsPayload = toolsListResponse.json || parseJsonOrSse(toolsListResponse.text);
  const tools = toolsPayload?.result?.tools;
  assert(
    Array.isArray(tools),
    `MCP tools/list response missing tools array. Raw body: ${toolsListResponse.text}`
  );
  assert(
    tools.some((tool) => tool?.name === 'list_entries'),
    'MCP tools/list missing required tool: list_entries'
  );

  await request(baseUrl, '/mcp', {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'mcp-session-id': sessionId,
    },
  });

  info('All acceptance checks passed.');
}

run().catch((error) => {
  process.stderr.write(`Acceptance test failed: ${error.message}\n`);
  process.exit(1);
});
