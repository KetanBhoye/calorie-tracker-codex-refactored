import { z } from 'zod';
import type { ToolHandler } from '../types/index.js';
import { BodyMeasurementRepository } from '../repositories/index.js';
import {
  createAuthError,
  createErrorResponse,
  createSuccessResponse,
} from '../utils/responses.js';

const listBodyMeasurementsSchema = z.object({
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
  limit: z.number().int().min(1).max(200).default(30).optional(),
  offset: z.number().int().min(0).default(0).optional(),
});

export const listBodyMeasurementsHandler: ToolHandler<
  z.infer<typeof listBodyMeasurementsSchema>
> = async (params, userId, env) => {
  if (!userId) {
    return createAuthError();
  }

  if (!env?.DB) {
    return createErrorResponse('Database not available. Please check your configuration.');
  }

  try {
    const validated = listBodyMeasurementsSchema.parse(params);
    const repository = new BodyMeasurementRepository(env.DB);

    const measurements = await repository.listByUser(userId, {
      date: validated.date,
      startDate: validated.start_date,
      endDate: validated.end_date,
      limit: validated.limit ?? 30,
      offset: validated.offset ?? 0,
    });

    return createSuccessResponse(
      JSON.stringify(
        {
          count: measurements.length,
          measurements,
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error('Error listing body measurements:', error);
    if (error instanceof z.ZodError) {
      return createErrorResponse(
        `Validation error: ${error.errors
          .map((entry) => `${entry.path.join('.')}: ${entry.message}`)
          .join(', ')}`
      );
    }
    return createErrorResponse(
      `Failed to list body measurements: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};
