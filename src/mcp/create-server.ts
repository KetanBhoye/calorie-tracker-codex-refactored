import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import z from 'zod';
import type { AppEnv, AuthUser } from '../db/types.js';
import {
  listEntriesHandler,
  type ListEntriesParams,
  addEntryHandler,
  type AddEntryParams,
  updateEntryHandler,
  type UpdateEntryParams,
  deleteEntryHandler,
  type DeleteEntryParams,
  registerUserHandler,
  type RegisterUserParams,
  revokeUserHandler,
  type RevokeUserParams,
  getProfile,
  updateProfile,
  getProfileHistory,
  type GetProfileHistoryParams,
  type UpdateProfileParams,
} from '../tools/index.js';

export function createCalorieTrackerMcpServer(env: AppEnv, user: AuthUser): McpServer {
  const server = new McpServer({
    name: 'Calorie Tracker Server',
    version: '2.0.0',
  });

  server.tool(
    'list_entries',
    'List food entries for a specific date with pagination. Returns daily calorie intake and nutritional data.',
    {
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
        .optional()
        .describe('Date in YYYY-MM-DD format (optional, defaults to today)'),
      limit: z
        .number()
        .int()
        .min(1, 'Limit must be at least 1')
        .max(100, 'Maximum limit is 100')
        .default(10)
        .optional(),
      offset: z
        .number()
        .int()
        .min(0, 'Offset cannot be negative')
        .default(0)
        .optional(),
    },
    async (params) => listEntriesHandler(params as ListEntriesParams, user.userId, env)
  );

  server.tool(
    'add_entry',
    'Add a new food entry to the calorie tracker',
    {
      food_name: z
        .string()
        .min(1, 'Food name is required')
        .describe('Name of the food item'),
      calories: z
        .number()
        .int()
        .min(0, 'Calories must be a non-negative integer')
        .describe('Number of calories'),
      protein_g: z
        .number()
        .min(0, 'Protein must be a non-negative number')
        .optional()
        .describe('Protein content in grams'),
      carbs_g: z
        .number()
        .min(0, 'Carbs must be a non-negative number')
        .optional()
        .describe('Carbohydrate content in grams'),
      fat_g: z
        .number()
        .min(0, 'Fat must be a non-negative number')
        .optional()
        .describe('Fat content in grams'),
      meal_type: z
        .enum(['breakfast', 'lunch', 'dinner', 'snack'])
        .optional()
        .describe('Type of meal'),
      entry_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
        .optional()
        .describe('Date in YYYY-MM-DD format (defaults to today)'),
    },
    async (params) => addEntryHandler(params as AddEntryParams, user.userId, env)
  );

  server.tool(
    'update_entry',
    'Update an existing food entry',
    {
      entry_id: z
        .string()
        .min(1, 'Entry ID is required')
        .describe('ID of the food entry to update'),
      food_name: z
        .string()
        .min(1, 'Food name cannot be empty')
        .optional()
        .describe('Updated name of the food item'),
      calories: z
        .number()
        .int()
        .min(0, 'Calories must be a non-negative integer')
        .optional()
        .describe('Updated number of calories'),
      protein_g: z
        .number()
        .min(0, 'Protein must be a non-negative number')
        .optional()
        .describe('Updated protein content in grams'),
      carbs_g: z
        .number()
        .min(0, 'Carbs must be a non-negative number')
        .optional()
        .describe('Updated carbohydrate content in grams'),
      fat_g: z
        .number()
        .min(0, 'Fat must be a non-negative number')
        .optional()
        .describe('Updated fat content in grams'),
      meal_type: z
        .enum(['breakfast', 'lunch', 'dinner', 'snack'])
        .optional()
        .describe('Updated type of meal'),
    },
    async (params) => updateEntryHandler(params as UpdateEntryParams, user.userId, env)
  );

  server.tool(
    'delete_entry',
    'Delete a food entry',
    {
      entry_id: z
        .string()
        .min(1, 'Entry ID is required')
        .describe('ID of the food entry to delete'),
    },
    async (params) => deleteEntryHandler(params as DeleteEntryParams, user.userId, env)
  );

  server.tool(
    'register_user',
    'Register a new user (admin only)',
    {
      email: z
        .string()
        .email('Invalid email format')
        .describe('Email address of the new user'),
      name: z
        .string()
        .min(1, 'Name is required')
        .describe('Full name of the new user'),
      api_key: z
        .string()
        .optional()
        .describe('Optional custom API key for the new user'),
    },
    async (params) =>
      registerUserHandler(
        params as RegisterUserParams,
        user.userId,
        env,
        user.isAdmin
      )
  );

  server.tool(
    'revoke_user',
    'Revoke a user API key (admin only)',
    {
      user_id: z.string().optional().describe('ID of the user to revoke'),
      email: z
        .string()
        .email('Invalid email format')
        .optional()
        .describe('Email of the user to revoke'),
    },
    async (params) =>
      revokeUserHandler(
        params as RevokeUserParams,
        user.userId,
        env,
        user.isAdmin
      )
  );

  server.tool(
    'get_profile',
    'Get current user profile with calculated BMR/TDEE metrics',
    {},
    async (params) => getProfile(params, user.userId, env)
  );

  server.tool(
    'update_profile',
    'Update user profile information and tracking data',
    {
      height_cm: z
        .number()
        .min(50, 'Height must be at least 50cm')
        .max(300, 'Height must be at most 300cm')
        .optional(),
      age: z
        .number()
        .int()
        .min(1, 'Age must be at least 1')
        .max(150, 'Age must be at most 150')
        .optional(),
      gender: z.enum(['male', 'female']).optional(),
      activity_level: z
        .enum(['sedentary', 'light', 'moderate', 'active', 'very_active'])
        .optional(),
      weight_kg: z
        .number()
        .min(1, 'Weight must be at least 1kg')
        .max(1000, 'Weight must be at most 1000kg')
        .optional(),
      muscle_mass_kg: z
        .number()
        .min(0, 'Muscle mass cannot be negative')
        .max(1000, 'Muscle mass must be at most 1000kg')
        .optional(),
      body_fat_percentage: z
        .number()
        .min(0, 'Body fat percentage cannot be negative')
        .max(100, 'Body fat percentage cannot exceed 100%')
        .optional(),
    },
    async (params) => updateProfile(params as UpdateProfileParams, user.userId, env)
  );

  server.tool(
    'get_profile_history',
    'Get historical profile tracking data with optional date filtering',
    {
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
        .optional(),
      start_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
        .optional(),
      end_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
        .optional(),
      limit: z
        .number()
        .int()
        .min(1, 'Limit must be at least 1')
        .max(100, 'Maximum limit is 100')
        .default(10)
        .optional(),
      offset: z
        .number()
        .int()
        .min(0, 'Offset cannot be negative')
        .default(0)
        .optional(),
    },
    async (params) =>
      getProfileHistory(params as any, user.userId, env)
  );

  return server;
}
