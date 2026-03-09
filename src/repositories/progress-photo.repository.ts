import { randomUUID } from 'node:crypto';
import type { ProgressPhoto, ProgressPoseType } from '../types/index.js';

type CreateProgressPhotoInput = Omit<ProgressPhoto, 'id' | 'created_at' | 'updated_at'>;

interface ListProgressPhotoOptions {
  date?: string;
  startDate?: string;
  endDate?: string;
  poseType?: ProgressPoseType;
  limit?: number;
  offset?: number;
}

export class ProgressPhotoRepository {
  constructor(private db: any) {}

  async create(photo: CreateProgressPhotoInput): Promise<ProgressPhoto> {
    const id = randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO progress_photos (
        id, user_id, recorded_date, pose_type, image_url, image_ref, notes, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *
    `);

    const result = await stmt
      .bind(
        id,
        photo.user_id,
        photo.recorded_date,
        photo.pose_type,
        photo.image_url || null,
        photo.image_ref || null,
        photo.notes || null
      )
      .first();

    if (!result) {
      throw new Error('Failed to create progress photo entry');
    }

    return result as ProgressPhoto;
  }

  async listByUser(userId: string, options: ListProgressPhotoOptions = {}): Promise<ProgressPhoto[]> {
    let query = 'SELECT * FROM progress_photos WHERE user_id = ?';
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

    if (options.poseType) {
      query += ' AND pose_type = ?';
      params.push(options.poseType);
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
    return result.results as ProgressPhoto[];
  }
}
