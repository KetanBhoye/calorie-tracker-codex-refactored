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

  app.all('/mcp', async (req, res) => {
    try {
      const sessionIdHeader = req.headers['mcp-session-id'];
      const sessionId = Array.isArray(sessionIdHeader)
        ? sessionIdHeader[0]
        : sessionIdHeader;

      if (sessionId && streamableSessions.has(sessionId)) {
        const existing = streamableSessions.get(sessionId)!;
        const user = await resolveRequestUser(req, env, existing.user);

        if (!user) {
          sendUnauthorizedWithMetadata(req, res);
          return;
        }

        if (user.userId !== existing.user.userId) {
          sendSessionMismatch(res);
          return;
        }

        await existing.transport.handleRequest(req as any, res as any, req.body);
        return;
      }

      const user = await resolveRequestUser(req, env);
      if (!user) {
        sendUnauthorizedWithMetadata(req, res);
        return;
      }

      if (req.method !== 'POST' || !isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message:
              'Bad Request: New MCP sessions must start with initialize request over POST.',
          },
          id: null,
        });
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          streamableSessions.set(newSessionId, { transport, user });
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) {
          streamableSessions.delete(sid);
        }
      };

      const server = createCalorieTrackerMcpServer(env, user);
      await server.connect(transport);
      await transport.handleRequest(req as any, res as any, req.body);
    } catch (error) {
      console.error('MCP /mcp error:', error);
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
    try {
      const user = await resolveRequestUser(req, env);
      if (!user) {
        sendUnauthorizedWithMetadata(req, res);
        return;
      }

      const transport = new SSEServerTransport('/messages', res as any);
      sseSessions.set(transport.sessionId, { transport, user });

      res.on('close', () => {
        sseSessions.delete(transport.sessionId);
      });

      const server = createCalorieTrackerMcpServer(env, user);
      await server.connect(transport);
      await transport.start();
    } catch (error) {
      console.error('MCP /sse error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to start SSE transport' });
      }
    }
  });

  app.post('/messages', async (req, res) => {
    try {
      const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : null;
      if (!sessionId) {
        res.status(400).json({ error: 'sessionId query parameter is required' });
        return;
      }

      const existing = sseSessions.get(sessionId);
      if (!existing) {
        res.status(404).json({ error: 'No active SSE session found for sessionId' });
        return;
      }

      const user = await resolveRequestUser(req, env, existing.user);
      if (!user) {
        sendUnauthorizedWithMetadata(req, res);
        return;
      }

      if (user.userId !== existing.user.userId) {
        sendSessionMismatch(res);
        return;
      }

      await existing.transport.handlePostMessage(req as any, res as any, req.body);
    } catch (error) {
      console.error('MCP /messages error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to handle SSE message' });
      }
    }
  });
}
