import { hashSha256 } from './security.js';

interface AuthEnv {
  DB?: {
    prepare: (query: string) => {
      bind: (...values: unknown[]) => {
        first: <T = Record<string, unknown>>() => Promise<T | null>;
      };
    };
  };
}

// Utility function to hash API keys using SHA-256
export async function hashApiKey(apiKey: string): Promise<string> {
  return hashSha256(apiKey);
}

// Database-driven authentication with role-based access control
export async function authenticateRequest(
  request: Request,
  env?: AuthEnv
): Promise<{ userId: string; isAdmin: boolean } | null> {
  const authHeader = request.headers.get('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7);
  const hashedToken = await hashApiKey(token);

  if (env?.DB) {
    try {
      const result = await env.DB
        .prepare('SELECT id, role FROM users WHERE api_key_hash = ?')
        .bind(hashedToken)
        .first<{ id: string; role: string }>();

      if (result) {
        return { userId: result.id, isAdmin: result.role === 'admin' };
      }
    } catch (error) {
      console.error('Database authentication error:', error);
      return null;
    }
  }

  return null;
}

// Middleware function to wrap around fetch-style handlers
export function withAuth(
  handler: (
    request: Request,
    env: AuthEnv,
    ctx: unknown,
    userId: string,
    isAdmin: boolean
  ) => Promise<Response>
) {
  return async (
    request: Request,
    env: AuthEnv,
    ctx: unknown
  ): Promise<Response> => {
    const authResult = await authenticateRequest(request, env);

    if (!authResult) {
      return new Response(
        JSON.stringify({
          error:
            'Unauthorized. Please provide a valid API key in the Authorization header.',
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return handler(request, env, ctx, authResult.userId, authResult.isAdmin);
  };
}
