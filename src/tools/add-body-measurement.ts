import { z } from 'zod';
import type { ToolHandler } from '../types/index.js';
import {
  BodyMeasurementRepository,
  ProfileTrackingRepository,
} from '../repositories/index.js';
import {
  createAuthError,
  createErrorResponse,
  createSuccessResponse,
} from '../utils/responses.js';

const addBodyMeasurementSchema = z
  .object({
    recorded_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
      .optional(),
    source_app: z.string().min(1).max(100).optional(),
    source_image_url: z.string().url().optional(),
    source_image_ref: z.string().min(1).max(500).optional(),
    body_weight_kg: z.number().min(1).max(1000).optional(),
    body_mass_index: z.number().min(1).max(100).optional(),
    body_fat_ratio_pct: z.number().min(0).max(100).optional(),
    muscle_rate_pct: z.number().min(0).max(100).optional(),
    body_water_pct: z.number().min(0).max(100).optional(),
    bone_mass_kg: z.number().min(0).max(100).optional(),
    basal_metabolic_rate_kcal: z.number().min(1).max(10000).optional(),
    metabolic_age_years: z.number().int().min(1).max(150).optional(),
    visceral_fat_pct: z.number().min(0).max(100).optional(),
    subcutaneous_fat_pct: z.number().min(0).max(100).optional(),
    protein_mass_kg: z.number().min(0).max(300).optional(),
    muscle_mass_kg: z.number().min(0).max(500).optional(),
    weight_without_fat_kg: z.number().min(0).max(1000).optional(),
    obesity_level: z.string().min(1).max(50).optional(),
    notes: z.string().max(4000).optional(),
    raw_payload_json: z.string().max(20000).optional(),
  })
  .refine(
    (value) =>
      [
        value.body_weight_kg,
        value.body_mass_index,
        value.body_fat_ratio_pct,
        value.muscle_rate_pct,
        value.body_water_pct,
        value.bone_mass_kg,
        value.basal_metabolic_rate_kcal,
        value.metabolic_age_years,
        value.visceral_fat_pct,
        value.subcutaneous_fat_pct,
        value.protein_mass_kg,
        value.muscle_mass_kg,
        value.weight_without_fat_kg,
        value.obesity_level,
      ].some((field) => field !== undefined),
    {
      message:
        'At least one measurement field is required (e.g., body_weight_kg, body_fat_ratio_pct).',
    }
  );

export const addBodyMeasurementHandler: ToolHandler<
  z.infer<typeof addBodyMeasurementSchema>
> = async (params, userId, env) => {
  if (!userId) {
    return createAuthError();
  }

  if (!env?.DB) {
    return createErrorResponse('Database not available. Please check your configuration.');
  }

  try {
    const validated = addBodyMeasurementSchema.parse(params);
    const recordedDate = validated.recorded_date || new Date().toISOString().split('T')[0];

    const measurementRepo = new BodyMeasurementRepository(env.DB);
    const trackingRepo = new ProfileTrackingRepository(env.DB);

    const measurement = await measurementRepo.create({
      user_id: userId,
      recorded_date: recordedDate,
      source_app: validated.source_app,
      source_image_url: validated.source_image_url,
      source_image_ref: validated.source_image_ref,
      body_weight_kg: validated.body_weight_kg,
      body_mass_index: validated.body_mass_index,
      body_fat_ratio_pct: validated.body_fat_ratio_pct,
      muscle_rate_pct: validated.muscle_rate_pct,
      body_water_pct: validated.body_water_pct,
      bone_mass_kg: validated.bone_mass_kg,
      basal_metabolic_rate_kcal: validated.basal_metabolic_rate_kcal,
      metabolic_age_years: validated.metabolic_age_years,
      visceral_fat_pct: validated.visceral_fat_pct,
      subcutaneous_fat_pct: validated.subcutaneous_fat_pct,
      protein_mass_kg: validated.protein_mass_kg,
      muscle_mass_kg: validated.muscle_mass_kg,
      weight_without_fat_kg: validated.weight_without_fat_kg,
      obesity_level: validated.obesity_level,
      notes: validated.notes,
      raw_payload_json: validated.raw_payload_json,
    });

    const trackingFields = {
      weight_kg: validated.body_weight_kg,
      muscle_mass_kg: validated.muscle_mass_kg,
      body_fat_percentage: validated.body_fat_ratio_pct,
      bmr_calories: validated.basal_metabolic_rate_kcal
        ? Math.round(validated.basal_metabolic_rate_kcal)
        : undefined,
    };

    const hasTrackingFields = Object.values(trackingFields).some((value) => value !== undefined);
    let profileTrackingSynced = false;

    if (hasTrackingFields) {
      const existingTracking = await trackingRepo.getTrackingByDate(userId, recordedDate);
      if (existingTracking) {
        await trackingRepo.updateTracking(existingTracking.id, trackingFields);
      } else {
        await trackingRepo.createTracking({
          user_id: userId,
          recorded_date: recordedDate,
          ...trackingFields,
        });
      }
      profileTrackingSynced = true;
    }

    return createSuccessResponse(
      JSON.stringify(
        {
          message: 'Body measurement saved successfully.',
          profile_tracking_synced: profileTrackingSynced,
          measurement,
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error('Error adding body measurement:', error);
    if (error instanceof z.ZodError) {
      return createErrorResponse(
        `Validation error: ${error.errors
          .map((entry) => `${entry.path.join('.')}: ${entry.message}`)
          .join(', ')}`
      );
    }
    return createErrorResponse(
      `Failed to add body measurement: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};
