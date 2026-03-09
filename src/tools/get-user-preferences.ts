import type { ToolHandler } from '../types/index.js';
import { UserTrackingPreferencesRepository } from '../repositories/index.js';
import {
  createAuthError,
  createErrorResponse,
  createSuccessResponse,
} from '../utils/responses.js';

export const getUserPreferencesHandler: ToolHandler = async (_params, userId, env) => {
  if (!userId) {
    return createAuthError();
  }

  if (!env?.DB) {
    return createErrorResponse('Database not available. Please check your configuration.');
  }

  try {
    const repository = new UserTrackingPreferencesRepository(env.DB);
    const preferences = await repository.getByUserId(userId);

    if (!preferences) {
      return createSuccessResponse(
        JSON.stringify(
          {
            message:
              'No user tracking preferences found yet. Use set_user_preferences to save your goals and instructions.',
            preferences: null,
          },
          null,
          2
        )
      );
    }

    return createSuccessResponse(
      JSON.stringify(
        {
          preferences,
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error('Error getting user preferences:', error);
    return createErrorResponse(
      `Failed to get user preferences: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};
