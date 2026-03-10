import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { AppEnv, AuthUser } from '../db/types.js';
import { authenticateRequestBearer } from '../auth/token-auth.js';
import { createCalorieTrackerMcpServer } from './create-server.js';

interface StreamableSession {
  transport: StreamableHTTPServerTransport;
  user: AuthUser;
}

interface SseSession {
  transport: SSEServerTransport;
  user: AuthUser;
}

function extractRpcMetadata(body: unknown): {
  rpcMethod: string | null;
  rpcId: string | number | null;
  toolName: string | null;
  hasArguments: boolean | null;
} {
  const request = Array.isArray(body) ? body[0] : body;
  if (!request || typeof request !== 'object') {
    return {
      rpcMethod: null,
      rpcId: null,
      toolName: null,
      hasArguments: null,
    };
  }

  const candidate = request as {
    method?: unknown;
    id?: unknown;
    params?: unknown;
  };
  const params =
    candidate.params && typeof candidate.params === 'object'
      ? (candidate.params as { name?: unknown; arguments?: unknown })
      : undefined;

  return {
    rpcMethod: typeof candidate.method === 'string' ? candidate.method : null,
    rpcId:
      typeof candidate.id === 'string' || typeof candidate.id === 'number'
        ? candidate.id
        : null,
    toolName: typeof params?.name === 'string' ? params.name : null,
    hasArguments: params ? params.arguments !== undefined : null,
  };
}

function logMcp(event: string, details: Record<string, unknown>): void {
  console.log(`[MCP] ${event} ${JSON.stringify(details)}`);
}

function normalizeMcpRequestBody(body: unknown): unknown {
  const requests = Array.isArray(body) ? body : [body];

  for (const request of requests) {
    if (!request || typeof request !== 'object') {
      continue;
    }

    const candidate = request as {
      method?: unknown;
      params?: unknown;
    };

    if (candidate.method !== 'tools/call') {
      continue;
    }

    if (!candidate.params || typeof candidate.params !== 'object') {
      candidate.params = { arguments: {} };
      continue;
    }

    const params = candidate.params as {
      arguments?: unknown;
    };

    if (params.arguments === undefined || params.arguments === null) {
      params.arguments = {};
    }
  }

  return body;
}

async function resolveRequestUser(
  req: Request,
  env: AppEnv,
  existingUser?: AuthUser
): Promise<AuthUser | null> {
  const hasAuthorization = Boolean(req.headers.authorization);

  if (!hasAuthorization && existingUser) {
    return existingUser;
  }

  return authenticateRequestBearer(env.DB, req);
}

function sendUnauthorized(res: Response): void {
  res.status(401).json({ error: 'Unauthorized. Provide Bearer token.' });
}

function buildBaseUrl(req: Request): string {
  const host = req.headers.host;
  const protocol = req.headers['x-forwarded-proto']?.toString().split(',')[0] || req.protocol;
  if (!host) {
    return `${protocol}://localhost`;
  }
  return `${protocol}://${host}`;
}

function sendUnauthorizedWithMetadata(req: Request, res: Response): void {
  const baseUrl = buildBaseUrl(req);
  const protectedResource = `${baseUrl}/.well-known/oauth-protected-resource`;
  const authorizationServer = `${baseUrl}/.well-known/oauth-authorization-server`;
  res.setHeader(
    'WWW-Authenticate',
    `Bearer realm="mcp", resource_metadata="${protectedResource}", authorization_server="${authorizationServer}", scope="mcp:tools"`
  );
  sendUnauthorized(res);
}

function sendSessionMismatch(res: Response): void {
  res.status(403).json({ error: 'Session does not belong to authenticated user.' });
}

export function registerMcpRoutes(app: Express, env: AppEnv): void {
  const streamableSessions = new Map<string, StreamableSession>();
  const sseSessions = new Map<string, SseSession>();

  const handleStatelessRequest = async (
    req: Request,
    res: Response,
    user: AuthUser,
    requestId: string,
    reason: string
  ): Promise<void> => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = createCalorieTrackerMcpServer(env, user);

    res.on('close', () => {
      transport.close().catch(() => undefined);
      server.close().catch(() => undefined);
    });

    await server.connect(transport);
    await transport.handleRequest(req as any, res as any, normalizeMcpRequestBody(req.body));
    logMcp('handled_stateless', {
      requestId,
      path: '/mcp',
      statusCode: res.statusCode,
      userId: user.userId,
      reason,
    });
  };

  app.all('/mcp', async (req, res) => {
    const requestId = randomUUID().slice(0, 8);
    try {
      const sessionIdHeader = req.headers['mcp-session-id'];
      const sessionId = Array.isArray(sessionIdHeader)
        ? sessionIdHeader[0]
        : sessionIdHeader;
      const rpc = extractRpcMetadata(req.body);
      logMcp('incoming', {
        requestId,
        path: '/mcp',
        httpMethod: req.method,
        sessionId: sessionId || null,
        hasAuthorization: Boolean(req.headers.authorization),
        userAgent: req.headers['user-agent'] || null,
        ...rpc,
      });

      if (sessionId && !streamableSessions.has(sessionId)) {
        const user = await resolveRequestUser(req, env);
        if (!user) {
          logMcp('unauthorized', {
            requestId,
            path: '/mcp',
            sessionId,
            reason: 'unknown-session-fallback',
          });
          sendUnauthorizedWithMetadata(req, res);
          return;
        }

        logMcp('stateless_fallback', {
          requestId,
          path: '/mcp',
          sessionId,
          reason: 'unknown-session-id',
        });
        await handleStatelessRequest(req, res, user, requestId, 'unknown-session-id');
        return;
      }

      if (sessionId && streamableSessions.has(sessionId)) {
        const existing = streamableSessions.get(sessionId)!;
        const user = await resolveRequestUser(req, env, existing.user);
        const requestBody = normalizeMcpRequestBody(req.body);

        if (!user) {
          logMcp('unauthorized', { requestId, path: '/mcp', sessionId });
          sendUnauthorizedWithMetadata(req, res);
          return;
        }

        if (user.userId !== existing.user.userId) {
          logMcp('session_mismatch', {
            requestId,
            path: '/mcp',
            sessionId,
            expectedUserId: existing.user.userId,
            actualUserId: user.userId,
          });
          sendSessionMismatch(res);
          return;
        }

        await existing.transport.handleRequest(req as any, res as any, requestBody);
        logMcp('handled', {
          requestId,
          path: '/mcp',
          sessionId,
          statusCode: res.statusCode,
          userId: user.userId,
        });
        return;
      }

      const user = await resolveRequestUser(req, env);
      if (!user) {
        logMcp('unauthorized', {
          requestId,
          path: '/mcp',
          sessionId: sessionId || null,
        });
        sendUnauthorizedWithMetadata(req, res);
        return;
      }

      if (req.method !== 'POST' || !isInitializeRequest(req.body)) {
        logMcp('stateless_fallback', {
          requestId,
          path: '/mcp',
          httpMethod: req.method,
          sessionId: sessionId || null,
          reason: 'non-initialize-request',
        });
        await handleStatelessRequest(req, res, user, requestId, 'non-initialize-request');
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          streamableSessions.set(newSessionId, { transport, user });
        },
        // Improves compatibility with connector clients that prefer JSON over SSE envelopes.
        enableJsonResponse: true,
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) {
          streamableSessions.delete(sid);
        }
      };

      const server = createCalorieTrackerMcpServer(env, user);
      await server.connect(transport);
      await transport.handleRequest(
        req as any,
        res as any,
        normalizeMcpRequestBody(req.body)
      );
      logMcp('handled', {
        requestId,
        path: '/mcp',
        sessionId: transport.sessionId || null,
        statusCode: res.statusCode,
        userId: user.userId,
      });
    } catch (error) {
      console.error('MCP /mcp error:', error);
      logMcp('error', {
        requestId,
        path: '/mcp',
        message: error instanceof Error ? error.message : String(error),
      });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }
    }
  });

  app.get('/sse', async (req, res) => {
    const requestId = randomUUID().slice(0, 8);
    try {
      const user = await resolveRequestUser(req, env);
      if (!user) {
        logMcp('unauthorized', { requestId, path: '/sse' });
        sendUnauthorizedWithMetadata(req, res);
        return;
      }

      logMcp('incoming', {
        requestId,
        path: '/sse',
        hasAuthorization: Boolean(req.headers.authorization),
        userAgent: req.headers['user-agent'] || null,
      });

      const transport = new SSEServerTransport('/messages', res as any);
      sseSessions.set(transport.sessionId, { transport, user });

      res.on('close', () => {
        sseSessions.delete(transport.sessionId);
      });

      const server = createCalorieTrackerMcpServer(env, user);
      await server.connect(transport);
      await transport.start();
      logMcp('handled', {
        requestId,
        path: '/sse',
        sessionId: transport.sessionId,
        statusCode: res.statusCode,
        userId: user.userId,
      });
    } catch (error) {
      console.error('MCP /sse error:', error);
      logMcp('error', {
        requestId,
        path: '/sse',
        message: error instanceof Error ? error.message : String(error),
      });
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to start SSE transport' });
      }
    }
  });

  app.post('/messages', async (req, res) => {
    const requestId = randomUUID().slice(0, 8);
    try {
      const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : null;
      const rpc = extractRpcMetadata(req.body);
      logMcp('incoming', {
        requestId,
        path: '/messages',
        sessionId,
        hasAuthorization: Boolean(req.headers.authorization),
        userAgent: req.headers['user-agent'] || null,
        ...rpc,
      });
      if (!sessionId) {
        logMcp('missing_session', { requestId, path: '/messages' });
        res.status(400).json({ error: 'sessionId query parameter is required' });
        return;
      }

      const existing = sseSessions.get(sessionId);
      if (!existing) {
        logMcp('session_not_found', { requestId, path: '/messages', sessionId });
        res.status(404).json({ error: 'No active SSE session found for sessionId' });
        return;
      }

      const user = await resolveRequestUser(req, env, existing.user);
      if (!user) {
        logMcp('unauthorized', { requestId, path: '/messages', sessionId });
        sendUnauthorizedWithMetadata(req, res);
        return;
      }

      if (user.userId !== existing.user.userId) {
        logMcp('session_mismatch', {
          requestId,
          path: '/messages',
          sessionId,
          expectedUserId: existing.user.userId,
          actualUserId: user.userId,
        });
        sendSessionMismatch(res);
        return;
      }

      await existing.transport.handlePostMessage(
        req as any,
        res as any,
        normalizeMcpRequestBody(req.body)
      );
      logMcp('handled', {
        requestId,
        path: '/messages',
        sessionId,
        statusCode: res.statusCode,
        userId: user.userId,
      });
    } catch (error) {
      console.error('MCP /messages error:', error);
      logMcp('error', {
        requestId,
        path: '/messages',
        message: error instanceof Error ? error.message : String(error),
      });
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to handle SSE message' });
      }
    }
  });
}
