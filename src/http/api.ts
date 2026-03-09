import { randomUUID } from 'node:crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import z from 'zod';
import type { AppEnv } from '../db/types.js';
import {
  createSession,
  clearSessionCookie,
  destroySession,
  getSessionIdFromCookie,
  getSessionUser,
  setSessionCookie,
  type SessionUser,
} from '../auth/session.js';
import {
  createPasswordHash,
  hashSha256,
  randomToken,
  verifyPassword,
} from '../auth/security.js';
import { FoodEntryRepository } from '../repositories/food-entry.repository.js';
import { UserProfileRepository } from '../repositories/user-profile.repository.js';
import { ProfileTrackingRepository } from '../repositories/profile-tracking.repository.js';
import { updateProfile, getProfileHistory } from '../tools/index.js';

interface ApiOptions {
  env: AppEnv;
  sessionTtlHours: number;
  secureCookies: boolean;
}

type AuthenticatedRequest = Request & {
  sessionUser?: SessionUser;
};

const signupSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  next: z.string().optional(),
});

const entryCreateSchema = z.object({
  food_name: z.string().min(1),
  calories: z.number().int().min(0),
  protein_g: z.number().min(0).optional(),
  carbs_g: z.number().min(0).optional(),
  fat_g: z.number().min(0).optional(),
  meal_type: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional(),
  entry_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

const entryUpdateSchema = z
  .object({
    food_name: z.string().min(1).optional(),
    calories: z.number().int().min(0).optional(),
    protein_g: z.number().min(0).optional(),
    carbs_g: z.number().min(0).optional(),
    fat_g: z.number().min(0).optional(),
    meal_type: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

function parseToolResult(result: {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}): { error?: string; payload?: unknown } {
  const text = result.content?.[0]?.text || '';

  if (result.isError) {
    return { error: text || 'Operation failed' };
  }

  try {
    return { payload: JSON.parse(text) };
  } catch {
    return { payload: { message: text } };
  }
}

export function registerApiRoutes(app: Express, options: ApiOptions): void {
  const { env } = options;

  const requireSession = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    const sessionId = getSessionIdFromCookie(req.headers.cookie);

    if (!sessionId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const user = await getSessionUser(env.DB, sessionId);
    if (!user) {
      clearSessionCookie(res, options.secureCookies);
      res.status(401).json({ error: 'Session expired or invalid' });
      return;
    }

    req.sessionUser = user;
    next();
  };

  app.post('/api/auth/signup', async (req, res) => {
    try {
      const parsed = signupSchema.safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.message });
        return;
      }

      const { name, email, password } = parsed.data;

      const existing = await env.DB
        .prepare('SELECT id FROM users WHERE email = ?')
        .bind(email)
        .first<{ id: string }>();

      if (existing) {
        res.status(409).json({ error: 'Email already registered' });
        return;
      }

      const userId = randomUUID();
      await env.DB
        .prepare(
          'INSERT INTO users (id, name, email, role, created_at, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)'
        )
        .bind(userId, name, email, 'user')
        .run();

      await env.DB
        .prepare(
          'INSERT INTO user_passwords (user_id, password_hash, created_at, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)'
        )
        .bind(userId, createPasswordHash(password))
        .run();

      const session = await createSession(env.DB, userId, options.sessionTtlHours);
      setSessionCookie(res, session.sessionId, session.expiresAt, options.secureCookies);

      res.status(201).json({
        user: { id: userId, name, email, role: 'user' },
      });
    } catch (error) {
      console.error('Signup error:', error);
      res.status(500).json({ error: 'Failed to create account' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const parsed = loginSchema.safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.message });
        return;
      }

      const { email, password, next } = parsed.data;

      const user = await env.DB
        .prepare('SELECT id, name, email, role FROM users WHERE email = ?')
        .bind(email)
        .first<{ id: string; name: string; email: string; role: string }>();

      if (!user) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }

      const passwordRecord = await env.DB
        .prepare('SELECT password_hash FROM user_passwords WHERE user_id = ?')
        .bind(user.id)
        .first<{ password_hash: string }>();

      if (!passwordRecord || !verifyPassword(password, passwordRecord.password_hash)) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }

      const session = await createSession(env.DB, user.id, options.sessionTtlHours);
      setSessionCookie(res, session.sessionId, session.expiresAt, options.secureCookies);

      res.json({
        user,
        next: next || '/dashboard',
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Failed to sign in' });
    }
  });

  app.post('/api/auth/logout', async (req, res) => {
    try {
      const sessionId = getSessionIdFromCookie(req.headers.cookie);
      if (sessionId) {
        await destroySession(env.DB, sessionId);
      }

      clearSessionCookie(res, options.secureCookies);
      res.json({ success: true });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({ error: 'Failed to sign out' });
    }
  });

  app.get('/api/me', requireSession, async (req: AuthenticatedRequest, res) => {
    const user = req.sessionUser!;
    res.json({
      id: user.userId,
      name: user.name,
      email: user.email,
      role: user.isAdmin ? 'admin' : 'user',
    });
  });

  app.get('/api/entries', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const date =
        typeof req.query.date === 'string'
          ? req.query.date
          : new Date().toISOString().split('T')[0];
      const limit = Number(req.query.limit || '100');
      const offset = Number(req.query.offset || '0');

      const repository = new FoodEntryRepository(env.DB);
      const entries = await repository.findByUserAndDate(req.sessionUser!.userId, {
        date,
        limit,
        offset,
      });

      const totals = entries.reduce(
        (acc, entry) => {
          acc.calories += entry.calories;
          acc.protein_g += entry.protein_g || 0;
          acc.carbs_g += entry.carbs_g || 0;
          acc.fat_g += entry.fat_g || 0;
          return acc;
        },
        { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
      );

      res.json({ date, entries, totals });
    } catch (error) {
      console.error('List entries error:', error);
      res.status(500).json({ error: 'Failed to list entries' });
    }
  });

  app.post('/api/entries', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const parsed = entryCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.message });
        return;
      }

      const repository = new FoodEntryRepository(env.DB);
      const entryId = await repository.create(parsed.data, req.sessionUser!.userId);

      res.status(201).json({ entry_id: entryId });
    } catch (error) {
      console.error('Create entry error:', error);
      res.status(500).json({ error: 'Failed to create entry' });
    }
  });

  app.patch('/api/entries/:entryId', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const parsed = entryUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.message });
        return;
      }

      const repository = new FoodEntryRepository(env.DB);
      const updated = await repository.update(
        req.params.entryId,
        req.sessionUser!.userId,
        parsed.data
      );

      if (!updated) {
        res.status(404).json({ error: 'Entry not found' });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Update entry error:', error);
      res.status(500).json({ error: 'Failed to update entry' });
    }
  });

  app.delete('/api/entries/:entryId', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const repository = new FoodEntryRepository(env.DB);
      const deleted = await repository.delete(req.params.entryId, req.sessionUser!.userId);

      if (!deleted) {
        res.status(404).json({ error: 'Entry not found' });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Delete entry error:', error);
      res.status(500).json({ error: 'Failed to delete entry' });
    }
  });

  app.get('/api/profile', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const profileRepo = new UserProfileRepository(env.DB);
      const profile = await profileRepo.getProfileById(req.sessionUser!.userId);

      if (!profile) {
        res.status(404).json({ error: 'Profile not found' });
        return;
      }

      res.json(profile);
    } catch (error) {
      console.error('Get profile error:', error);
      res.status(500).json({ error: 'Failed to load profile' });
    }
  });

  app.put('/api/profile', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const result = await updateProfile(req.body, req.sessionUser!.userId, env);
      const parsed = parseToolResult(result);

      if (parsed.error) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      res.json(parsed.payload);
    } catch (error) {
      console.error('Update profile error:', error);
      res.status(500).json({ error: 'Failed to update profile' });
    }
  });

  app.get('/api/profile/history', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const result = await getProfileHistory(
        {
          date: typeof req.query.date === 'string' ? req.query.date : undefined,
          start_date:
            typeof req.query.start_date === 'string'
              ? req.query.start_date
              : undefined,
          end_date:
            typeof req.query.end_date === 'string' ? req.query.end_date : undefined,
          limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : 30,
          offset: typeof req.query.offset === 'string' ? Number(req.query.offset) : 0,
        },
        req.sessionUser!.userId,
        env
      );

      const parsed = parseToolResult(result);
      if (parsed.error) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      res.json(parsed.payload);
    } catch (error) {
      console.error('Profile history error:', error);
      res.status(500).json({ error: 'Failed to get profile history' });
    }
  });

  app.get('/api/dashboard', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.sessionUser!.userId;
      const date =
        typeof req.query.date === 'string'
          ? req.query.date
          : new Date().toISOString().split('T')[0];

      const foodRepo = new FoodEntryRepository(env.DB);
      const profileRepo = new UserProfileRepository(env.DB);
      const trackingRepo = new ProfileTrackingRepository(env.DB);

      const entries = await foodRepo.findByUserAndDate(userId, { date, limit: 200, offset: 0 });
      const profile = await profileRepo.getProfileById(userId);
      const history = await trackingRepo.getTrackingByUserId(userId, { limit: 14 });

      const totals = entries.reduce(
        (acc, entry) => {
          acc.calories += entry.calories;
          acc.protein_g += entry.protein_g || 0;
          acc.carbs_g += entry.carbs_g || 0;
          acc.fat_g += entry.fat_g || 0;
          return acc;
        },
        { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
      );

      const mealBreakdown = entries.reduce<Record<string, number>>((acc, entry) => {
        const key = entry.meal_type || 'unknown';
        acc[key] = (acc[key] || 0) + entry.calories;
        return acc;
      }, {});

      res.json({
        user: {
          id: userId,
          name: req.sessionUser!.name,
          email: req.sessionUser!.email,
        },
        date,
        totals,
        meal_breakdown: mealBreakdown,
        entries,
        profile,
        recent_tracking: history,
      });
    } catch (error) {
      console.error('Dashboard error:', error);
      res.status(500).json({ error: 'Failed to load dashboard' });
    }
  });

  app.post('/api/tokens/rotate', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const token = randomToken(24);

      await env.DB
        .prepare('UPDATE users SET api_key_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(hashSha256(token), req.sessionUser!.userId)
        .run();

      res.json({
        token,
        message: 'New API token generated. Store it securely; it will not be shown again.',
      });
    } catch (error) {
      console.error('Token rotate error:', error);
      res.status(500).json({ error: 'Failed to rotate API token' });
    }
  });

  app.get('/api/admin/bootstrap-info', requireSession, async (req: AuthenticatedRequest, res) => {
    if (!req.sessionUser?.isAdmin) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    res.json({
      admin_api_key_configured: Boolean(options.env.ADMIN_API_KEY),
      oauth_registration_endpoint: '/oauth/register',
      headers_required: ['X-API-Key'],
    });
  });
}
