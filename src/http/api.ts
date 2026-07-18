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
import { FoodLibraryRepository, type MealType } from '../repositories/food-library.repository.js';
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
  food_id: z.string().uuid().optional(),
  quantity: z.number().positive().max(10000).optional(),
  unit: z.string().max(20).optional(),
});

const suggestionsQuerySchema = z.object({
  meal: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

const foodCreateSchema = z.object({
  canonical_name: z.string().min(1).max(200),
  reference_unit: z.string().min(1).max(20),
  // Per-unit values, so an implausible number here would scale into every
  // future entry made from this food.
  calories_per_unit: z.number().min(0).max(1000),
  protein_g_per_unit: z.number().min(0).max(100).optional(),
  carbs_g_per_unit: z.number().min(0).max(100).optional(),
  fat_g_per_unit: z.number().min(0).max(100).optional(),
  default_quantity: z.number().positive().max(10000).default(1),
  source: z.enum(['curated_cache', 'openfoodfacts', 'usda', 'manual']).default('manual'),
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

      const userId = req.sessionUser!.userId;
      const library = new FoodLibraryRepository(env.DB);

      // Resolve the canonical food so this entry counts toward future
      // suggestions. Callers that already know the food (the PWA) pass
      // food_id; MCP and other clients send free text, so fall back to
      // matching on the normalised name.
      let foodId = parsed.data.food_id;
      if (!foodId) {
        const match = await library.findByName(userId, parsed.data.food_name);
        foodId = match?.id;
      }

      const repository = new FoodEntryRepository(env.DB);
      const entryId = await repository.create(
        { ...parsed.data, food_id: foodId },
        userId
      );

      res.status(201).json({ entry_id: entryId, food_id: foodId ?? null });
    } catch (error) {
      console.error('Create entry error:', error);
      res.status(500).json({ error: 'Failed to create entry' });
    }
  });

  app.get('/api/suggestions', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const parsed = suggestionsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.message });
        return;
      }

      const repository = new FoodLibraryRepository(env.DB);
      const suggestions = await repository.suggestForMeal(
        req.sessionUser!.userId,
        parsed.data.meal as MealType,
        parsed.data.limit
      );

      res.json({ meal_type: parsed.data.meal, suggestions });
    } catch (error) {
      console.error('Suggestions error:', error);
      res.status(500).json({ error: 'Failed to load suggestions' });
    }
  });

  app.get('/api/stats/weekly', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const days = Math.min(90, Math.max(7, Number(req.query.days || '30')));
      const repository = new FoodEntryRepository(env.DB);
      const daily = await repository.getDailyTotals(req.sessionUser!.userId, days);

      // A day only counts toward the streak if enough was logged to be a real
      // day's record. The history contains days with a single 240 kcal entry —
      // those are abandoned logs, not fasts, and counting them would make the
      // streak flatter.
      const COMPLETE_DAY_KCAL = 1200;
      const logged = new Set(daily.filter((d) => d.calories >= COMPLETE_DAY_KCAL).map((d) => d.entry_date));

      let streak = 0;
      const cursor = new Date();
      // Today doesn't break the streak until it ends, so start from today only
      // if it already qualifies, otherwise from yesterday.
      if (!logged.has(cursor.toISOString().split('T')[0]!)) {
        cursor.setDate(cursor.getDate() - 1);
      }
      while (logged.has(cursor.toISOString().split('T')[0]!)) {
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
      }

      const complete = daily.filter((d) => d.calories >= COMPLETE_DAY_KCAL);
      const average =
        complete.length > 0
          ? Math.round(complete.reduce((sum, d) => sum + d.calories, 0) / complete.length)
          : 0;

      res.json({
        days,
        daily,
        streak,
        days_logged: daily.length,
        complete_days: complete.length,
        average_calories: average,
        complete_day_threshold: COMPLETE_DAY_KCAL,
      });
    } catch (error) {
      console.error('Weekly stats error:', error);
      res.status(500).json({ error: 'Failed to load stats' });
    }
  });

  app.get('/api/foods/search', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      if (query.length < 2) {
        res.status(400).json({ error: 'Query must be at least 2 characters' });
        return;
      }

      const repository = new FoodLibraryRepository(env.DB);
      const foods = await repository.search(req.sessionUser!.userId, query);

      res.json({ query, foods });
    } catch (error) {
      console.error('Food search error:', error);
      res.status(500).json({ error: 'Failed to search foods' });
    }
  });

  app.post('/api/foods', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const parsed = foodCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.message });
        return;
      }

      const repository = new FoodLibraryRepository(env.DB);
      const foodId = await repository.upsert(req.sessionUser!.userId, {
        canonical_name: parsed.data.canonical_name,
        reference_unit: parsed.data.reference_unit,
        calories_per_unit: parsed.data.calories_per_unit,
        protein_g_per_unit: parsed.data.protein_g_per_unit ?? null,
        carbs_g_per_unit: parsed.data.carbs_g_per_unit ?? null,
        fat_g_per_unit: parsed.data.fat_g_per_unit ?? null,
        default_quantity: parsed.data.default_quantity,
        source: parsed.data.source,
      });

      res.status(201).json({ food_id: foodId });
    } catch (error) {
      console.error('Create food error:', error);
      res.status(500).json({ error: 'Failed to create food' });
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
