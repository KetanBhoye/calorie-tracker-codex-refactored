import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { D1DatabaseCompat } from './types.js';
import { createPasswordHash, hashSha256 } from '../auth/security.js';

interface BootstrapOptions {
  migrationsDir: string;
  adminApiKey: string;
  adminEmail?: string;
  adminPassword?: string;
}

export async function bootstrapDatabase(
  db: D1DatabaseCompat,
  options: BootstrapOptions
): Promise<void> {
  await runMigrations(db, options.migrationsDir);
  await ensureDefaultAdmin(db, options);
  await cleanupExpiredAuthData(db);
}

async function runMigrations(
  db: D1DatabaseCompat,
  migrationsDir: string
): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const migrationFiles = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  for (const file of migrationFiles) {
    const existing = await db
      .prepare('SELECT name FROM schema_migrations WHERE name = ?')
      .bind(file)
      .first<{ name: string }>();

    if (existing) {
      continue;
    }

    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    await db.exec(sql);
    await db
      .prepare('INSERT INTO schema_migrations (name) VALUES (?)')
      .bind(file)
      .run();
  }
}

async function ensureDefaultAdmin(
  db: D1DatabaseCompat,
  options: BootstrapOptions
): Promise<void> {
  const adminEmail = options.adminEmail || 'admin@calorie-tracker.local';
  const adminPassword = options.adminPassword || 'admin123456';
  const adminApiKeyHash = hashSha256(options.adminApiKey);

  const existingAdmin = await db
    .prepare('SELECT id FROM users WHERE id = ?')
    .bind('admin')
    .first<{ id: string }>();

  if (!existingAdmin) {
    await db
      .prepare(
        'INSERT INTO users (id, name, email, role, api_key_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)'
      )
      .bind('admin', 'Admin User', adminEmail, 'admin', adminApiKeyHash)
      .run();

    await db
      .prepare(
        'INSERT INTO user_passwords (user_id, password_hash, created_at, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)'
      )
      .bind('admin', createPasswordHash(adminPassword))
      .run();

    return;
  }

  await db
    .prepare(
      'UPDATE users SET role = ?, api_key_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    )
    .bind('admin', adminApiKeyHash, 'admin')
    .run();
}

async function cleanupExpiredAuthData(db: D1DatabaseCompat): Promise<void> {
  await db
    .prepare("DELETE FROM oauth_authorization_codes WHERE datetime(expires_at) <= datetime('now')")
    .bind()
    .run();

  await db
    .prepare("DELETE FROM oauth_tokens WHERE datetime(expires_at) <= datetime('now')")
    .bind()
    .run();

  await db
    .prepare("DELETE FROM web_sessions WHERE datetime(expires_at) <= datetime('now')")
    .bind()
    .run();
}
