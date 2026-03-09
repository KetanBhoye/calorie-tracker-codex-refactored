import { randomUUID } from 'node:crypto';
import type { BodyMeasurement } from '../types/index.js';

type CreateBodyMeasurementInput = Omit<
  BodyMeasurement,
  'id' | 'created_at' | 'updated_at'
>;

interface ListBodyMeasurementOptions {
  date?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export class BodyMeasurementRepository {
  constructor(private db: any) {}

  async create(measurement: CreateBodyMeasurementInput): Promise<BodyMeasurement> {
    const id = randomUUID();

    const stmt = this.db.prepare(`
      INSERT INTO body_measurements (
        id, user_id, recorded_date, source_app, source_image_url, source_image_ref,
        body_weight_kg, body_mass_index, body_fat_ratio_pct, muscle_rate_pct, body_water_pct,
        bone_mass_kg, basal_metabolic_rate_kcal, metabolic_age_years, visceral_fat_pct,
        subcutaneous_fat_pct, protein_mass_kg, muscle_mass_kg, weight_without_fat_kg,
        obesity_level, notes, raw_payload_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *
    `);

    const result = await stmt
      .bind(
        id,
        measurement.user_id,
        measurement.recorded_date,
        measurement.source_app || null,
        measurement.source_image_url || null,
        measurement.source_image_ref || null,
        measurement.body_weight_kg ?? null,
        measurement.body_mass_index ?? null,
        measurement.body_fat_ratio_pct ?? null,
        measurement.muscle_rate_pct ?? null,
        measurement.body_water_pct ?? null,
        measurement.bone_mass_kg ?? null,
        measurement.basal_metabolic_rate_kcal ?? null,
        measurement.metabolic_age_years ?? null,
        measurement.visceral_fat_pct ?? null,
        measurement.subcutaneous_fat_pct ?? null,
        measurement.protein_mass_kg ?? null,
        measurement.muscle_mass_kg ?? null,
        measurement.weight_without_fat_kg ?? null,
        measurement.obesity_level || null,
        measurement.notes || null,
        measurement.raw_payload_json || null
      )
      .first();

    if (!result) {
      throw new Error('Failed to create body measurement');
    }

    return result as BodyMeasurement;
  }

  async listByUser(userId: string, options: ListBodyMeasurementOptions = {}): Promise<BodyMeasurement[]> {
    let query = 'SELECT * FROM body_measurements WHERE user_id = ?';
    const params: Array<string | number> = [userId];

    if (options.date) {
      query += ' AND recorded_date = ?';
      params.push(options.date);
    } else {
      if (options.startDate) {
        query += ' AND recorded_date >= ?';
        params.push(options.startDate);
      }
      if (options.endDate) {
        query += ' AND recorded_date <= ?';
        params.push(options.endDate);
      }
    }

    query += ' ORDER BY recorded_date DESC, created_at DESC';

    if (options.limit !== undefined) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    if (options.offset !== undefined) {
      query += ' OFFSET ?';
      params.push(options.offset);
    }

    const result = await this.db.prepare(query).bind(...params).all();
    return result.results as BodyMeasurement[];
  }

  async getLatestByDate(userId: string, date: string): Promise<BodyMeasurement | null> {
    const result = await this.db
      .prepare(`
        SELECT * FROM body_measurements
        WHERE user_id = ? AND recorded_date = ?
        ORDER BY created_at DESC
        LIMIT 1
      `)
      .bind(userId, date)
      .first();

    return (result as BodyMeasurement | null) || null;
  }
}
