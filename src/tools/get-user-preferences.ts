import type { GetUserPreferencesParams, ToolHandler } from '../types/index.js';
import { UserTrackingPreferencesRepository } from '../repositories/index.js';
import {
  createAuthError,
  createErrorResponse,
  createSuccessResponse,
} from '../utils/responses.js';

const DEFAULT_MAX_CHARS_PER_FIELD = 2000;
const MIN_MAX_CHARS_PER_FIELD = 500;
const MAX_MAX_CHARS_PER_FIELD = 20000;

function clampMaxChars(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_MAX_CHARS_PER_FIELD;
  }

  return Math.min(MAX_MAX_CHARS_PER_FIELD, Math.max(MIN_MAX_CHARS_PER_FIELD, Math.floor(parsed)));
}

function summarizeText(
  value: string | undefined,
  includeFullText: boolean,
  maxChars: number
): {
  text: string | null;
  length: number;
  truncated: boolean;
} {
  if (!value) {
    return {
      text: null,
      length: 0,
      truncated: false,
    };
  }

  if (includeFullText || value.length <= maxChars) {
    return {
      text: value,
      length: value.length,
      truncated: false,
    };
  }

  return {
    text: `${value.slice(0, maxChars)}\n\n...[truncated]`,
    length: value.length,
    truncated: true,
  };
}

export const getUserPreferencesHandler: ToolHandler<GetUserPreferencesParams> = async (
  params,
  userId,
  env
) => {
  if (!userId) {
    return createAuthError();
  }

  if (!env?.DB) {
    return createErrorResponse('Database not available. Please check your configuration.');
  }

  try {
    const repository = new UserTrackingPreferencesRepository(env.DB);
    const preferences = await repository.getByUserId(userId);
    const includeFullText = Boolean(params?.include_full_text);
    const maxChars = clampMaxChars(params?.max_chars_per_field);

    if (!preferences) {
      return createSuccessResponse(
        JSON.stringify(
          {
            message:
              'No user tracking preferences found yet. Use set_user_preferences to save your goals and instructions.',
            preferences: null,
            retrieval_options: {
              include_full_text: includeFullText,
              max_chars_per_field: maxChars,
            },
          },
          null,
          2
        )
      );
    }

    const behaviorInstructions = summarizeText(
      preferences.behavior_instructions,
      includeFullText,
      maxChars
    );
    const macrosCacheNotes = summarizeText(
      preferences.macros_cache_notes,
      includeFullText,
      maxChars
    );

    return createSuccessResponse(
      JSON.stringify(
        {
          preferences: {
            user_id: preferences.user_id,
            display_name: preferences.display_name ?? null,
            daily_calorie_goal: preferences.daily_calorie_goal ?? null,
            daily_protein_goal_g: preferences.daily_protein_goal_g ?? null,
            daily_carbs_goal_g: preferences.daily_carbs_goal_g ?? null,
            daily_fat_goal_g: preferences.daily_fat_goal_g ?? null,
            behavior_instructions: behaviorInstructions.text,
            behavior_instructions_length: behaviorInstructions.length,
            behavior_instructions_truncated: behaviorInstructions.truncated,
            macros_cache_notes: macrosCacheNotes.text,
            macros_cache_notes_length: macrosCacheNotes.length,
            macros_cache_notes_truncated: macrosCacheNotes.truncated,
            created_at: preferences.created_at,
            updated_at: preferences.updated_at,
          },
          retrieval_options: {
            include_full_text: includeFullText,
            max_chars_per_field: maxChars,
          },
          note:
            includeFullText
              ? 'Full text fields were returned.'
              : 'Long text fields were truncated to keep MCP responses reliable. Set include_full_text=true to fetch complete text.',
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
