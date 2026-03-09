import { z } from 'zod';
import type { ToolHandler } from '../types/index.js';
import { UserTrackingPreferencesRepository } from '../repositories/index.js';
import {
  createAuthError,
  createErrorResponse,
  createSuccessResponse,
} from '../utils/responses.js';

const setUserPreferencesSchema = z
  .object({
    display_name: z.string().min(1).max(100).optional(),
    daily_calorie_goal: z.number().int().min(500).max(10000).optional(),
    daily_protein_goal_g: z.number().min(0).max(1000).optional(),
    daily_carbs_goal_g: z.number().min(0).max(2000).optional(),
    daily_fat_goal_g: z.number().min(0).max(1000).optional(),
    behavior_instructions: z.string().max(50000).optional(),
    macros_cache_notes: z.string().max(150000).optional(),
  })
  .refine(
    (value) =>
      Object.values(value).some((entry) => entry !== undefined),
    {
      message: 'Provide at least one preference field to update.',
    }
  );

export const setUserPreferencesHandler: ToolHandler<
  z.infer<typeof setUserPreferencesSchema>
> = async (params, userId, env) => {
  if (!userId) {
    return createAuthError();
  }

  if (!env?.DB) {
    return createErrorResponse('Database not available. Please check your configuration.');
  }

  try {
    const validated = setUserPreferencesSchema.parse(params);
    const repository = new UserTrackingPreferencesRepository(env.DB);
    const preferences = await repository.upsert(userId, validated);

    return createSuccessResponse(
      JSON.stringify(
        {
          message: 'User tracking preferences updated successfully.',
          preferences,
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error('Error setting user preferences:', error);
    if (error instanceof z.ZodError) {
      return createErrorResponse(
        `Validation error: ${error.errors
          .map((entry) => `${entry.path.join('.')}: ${entry.message}`)
          .join(', ')}`
      );
    }
    return createErrorResponse(
      `Failed to set user preferences: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};
