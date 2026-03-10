import { z } from 'zod';
import type { ToolHandler } from '../types/index.js';
import { ProgressPhotoRepository } from '../repositories/index.js';
import {
  createAuthError,
  createErrorResponse,
  createSuccessResponse,
} from '../utils/responses.js';

const listProgressPhotosSchema = z.object({
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
  pose_type: z.enum(['front', 'back', 'left_side', 'right_side', 'other']).optional(),
  limit: z.number().int().min(1).max(200).default(30).optional(),
  offset: z.number().int().min(0).default(0).optional(),
});

export const listProgressPhotosHandler: ToolHandler<
  z.infer<typeof listProgressPhotosSchema>
> = async (params, userId, env) => {
  if (!userId) {
    return createAuthError();
  }

  if (!env?.DB) {
    return createErrorResponse('Database not available. Please check your configuration.');
  }

  try {
    const validated = listProgressPhotosSchema.parse(params ?? {});
    const repository = new ProgressPhotoRepository(env.DB);

    const photos = await repository.listByUser(userId, {
      date: validated.date,
      startDate: validated.start_date,
      endDate: validated.end_date,
      poseType: validated.pose_type,
      limit: validated.limit ?? 30,
      offset: validated.offset ?? 0,
    });

    return createSuccessResponse(
      JSON.stringify(
        {
          count: photos.length,
          photos,
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error('Error listing progress photos:', error);
    if (error instanceof z.ZodError) {
      return createErrorResponse(
        `Validation error: ${error.errors
          .map((entry) => `${entry.path.join('.')}: ${entry.message}`)
          .join(', ')}`
      );
    }
    return createErrorResponse(
      `Failed to list progress photos: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};
