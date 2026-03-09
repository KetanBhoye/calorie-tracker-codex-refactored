import { z } from 'zod';
import type { ToolHandler } from '../types/index.js';
import {
  BodyMeasurementRepository,
  ProgressPhotoRepository,
} from '../repositories/index.js';
import {
  createAuthError,
  createErrorResponse,
  createSuccessResponse,
} from '../utils/responses.js';

const compareProgressSchema = z.object({
  from_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  to_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  include_photos: z.boolean().default(true).optional(),
});

const numericKeys = [
  'body_weight_kg',
  'body_mass_index',
  'body_fat_ratio_pct',
  'muscle_rate_pct',
  'body_water_pct',
  'bone_mass_kg',
  'basal_metabolic_rate_kcal',
  'metabolic_age_years',
  'visceral_fat_pct',
  'subcutaneous_fat_pct',
  'protein_mass_kg',
  'muscle_mass_kg',
  'weight_without_fat_kg',
] as const;

export const compareProgressHandler: ToolHandler<
  z.infer<typeof compareProgressSchema>
> = async (params, userId, env) => {
  if (!userId) {
    return createAuthError();
  }

  if (!env?.DB) {
    return createErrorResponse('Database not available. Please check your configuration.');
  }

  try {
    const validated = compareProgressSchema.parse(params);
    const measurementRepo = new BodyMeasurementRepository(env.DB);
    const photoRepo = new ProgressPhotoRepository(env.DB);

    const fromMeasurement = await measurementRepo.getLatestByDate(
      userId,
      validated.from_date
    );
    const toMeasurement = await measurementRepo.getLatestByDate(
      userId,
      validated.to_date
    );

    const changes: Record<string, number> = {};
    if (fromMeasurement && toMeasurement) {
      for (const key of numericKeys) {
        const fromValue = fromMeasurement[key];
        const toValue = toMeasurement[key];
        if (typeof fromValue === 'number' && typeof toValue === 'number') {
          changes[key] = Number((toValue - fromValue).toFixed(3));
        }
      }
    }

    let photos = undefined as
      | {
          from: Record<string, Array<{ image_url?: string; image_ref?: string; notes?: string }>>;
          to: Record<string, Array<{ image_url?: string; image_ref?: string; notes?: string }>>;
        }
      | undefined;

    if (validated.include_photos ?? true) {
      const fromPhotos = await photoRepo.listByUser(userId, { date: validated.from_date, limit: 200 });
      const toPhotos = await photoRepo.listByUser(userId, { date: validated.to_date, limit: 200 });

      const reduceByPose = (
        entries: typeof fromPhotos
      ): Record<string, Array<{ image_url?: string; image_ref?: string; notes?: string }>> =>
        entries.reduce((accumulator, entry) => {
          if (!accumulator[entry.pose_type]) {
            accumulator[entry.pose_type] = [];
          }
          accumulator[entry.pose_type].push({
            image_url: entry.image_url,
            image_ref: entry.image_ref,
            notes: entry.notes,
          });
          return accumulator;
        }, {} as Record<string, Array<{ image_url?: string; image_ref?: string; notes?: string }>>);

      photos = {
        from: reduceByPose(fromPhotos),
        to: reduceByPose(toPhotos),
      };
    }

    return createSuccessResponse(
      JSON.stringify(
        {
          from_date: validated.from_date,
          to_date: validated.to_date,
          from_measurement: fromMeasurement,
          to_measurement: toMeasurement,
          numeric_changes: changes,
          photos,
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error('Error comparing progress:', error);
    if (error instanceof z.ZodError) {
      return createErrorResponse(
        `Validation error: ${error.errors
          .map((entry) => `${entry.path.join('.')}: ${entry.message}`)
          .join(', ')}`
      );
    }
    return createErrorResponse(
      `Failed to compare progress: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};
