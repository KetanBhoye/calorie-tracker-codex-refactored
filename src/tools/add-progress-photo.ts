import { z } from 'zod';
import type { ToolHandler } from '../types/index.js';
import { ProgressPhotoRepository } from '../repositories/index.js';
import {
  createAuthError,
  createErrorResponse,
  createSuccessResponse,
} from '../utils/responses.js';

const addProgressPhotoSchema = z
  .object({
    recorded_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
      .optional(),
    pose_type: z.enum(['front', 'back', 'left_side', 'right_side', 'other']),
    image_url: z.string().url().optional(),
    image_ref: z.string().min(1).max(500).optional(),
    notes: z.string().max(4000).optional(),
  })
  .refine((value) => value.image_url || value.image_ref || value.notes, {
    message: 'Provide at least one of image_url, image_ref, or notes.',
  });

export const addProgressPhotoHandler: ToolHandler<
  z.infer<typeof addProgressPhotoSchema>
> = async (params, userId, env) => {
  if (!userId) {
    return createAuthError();
  }

  if (!env?.DB) {
    return createErrorResponse('Database not available. Please check your configuration.');
  }

  try {
    const validated = addProgressPhotoSchema.parse(params);
    const repository = new ProgressPhotoRepository(env.DB);
    const recordedDate = validated.recorded_date || new Date().toISOString().split('T')[0];

    const photo = await repository.create({
      user_id: userId,
      recorded_date: recordedDate,
      pose_type: validated.pose_type,
      image_url: validated.image_url,
      image_ref: validated.image_ref,
      notes: validated.notes,
    });

    return createSuccessResponse(
      JSON.stringify(
        {
          message: 'Progress photo entry saved successfully.',
          photo,
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error('Error adding progress photo:', error);
    if (error instanceof z.ZodError) {
      return createErrorResponse(
        `Validation error: ${error.errors
          .map((entry) => `${entry.path.join('.')}: ${entry.message}`)
          .join(', ')}`
      );
    }
    return createErrorResponse(
      `Failed to add progress photo: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};
