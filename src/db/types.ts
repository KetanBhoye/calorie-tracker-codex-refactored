export interface D1RunResult {
  meta: {
    changes: number;
    last_row_id?: number;
  };
  changes?: number;
}

export interface D1QueryResult<T = Record<string, unknown>> {
  results: T[];
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<D1RunResult>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1QueryResult<T>>;
}

export interface D1DatabaseCompat {
  prepare(query: string): D1PreparedStatement;
  exec(query: string): Promise<void>;
}

export interface AppEnv {
  DB: D1DatabaseCompat;
  ADMIN_API_KEY: string;
}

export interface AuthUser {
  userId: string;
  isAdmin: boolean;
}
