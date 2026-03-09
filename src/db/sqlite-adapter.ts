import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  D1DatabaseCompat,
  D1PreparedStatement,
  D1QueryResult,
  D1RunResult,
} from './types.js';

class SqlitePreparedStatement implements D1PreparedStatement {
  private boundValues: unknown[] = [];

  constructor(private readonly statement: Database.Statement) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.boundValues = values;
    return this;
  }

  async run(): Promise<D1RunResult> {
    const result = this.statement.run(...this.boundValues);
    return {
      meta: {
        changes: result.changes,
        last_row_id:
          typeof result.lastInsertRowid === 'number'
            ? result.lastInsertRowid
            : Number(result.lastInsertRowid),
      },
      changes: result.changes,
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.statement.get(...this.boundValues) as T | undefined;
    return row ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1QueryResult<T>> {
    const rows = this.statement.all(...this.boundValues) as T[];
    return { results: rows };
  }
}

export class SqliteD1Database implements D1DatabaseCompat {
  constructor(private readonly db: Database.Database) {}

  prepare(query: string): D1PreparedStatement {
    const statement = this.db.prepare(query);
    return new SqlitePreparedStatement(statement);
  }

  async exec(query: string): Promise<void> {
    this.db.exec(query);
  }
}

export function openSqliteDatabase(databasePath: string): {
  raw: Database.Database;
  compat: SqliteD1Database;
} {
  mkdirSync(dirname(databasePath), { recursive: true });
  const raw = new Database(databasePath);
  raw.pragma('foreign_keys = ON');
  return { raw, compat: new SqliteD1Database(raw) };
}
