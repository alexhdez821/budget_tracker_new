import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/0001_init.sql", "utf8");

interface BoundStatement {
  bind(...values: unknown[]): BoundStatement;
  run(): Promise<{ meta: { changes: number } }>;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
}

export function createTestDatabase(): D1Database {
  const db = new DatabaseSync(":memory:");
  db.exec(migration);
  const statement = (sql: string, params: unknown[]): BoundStatement => ({
    bind(...values: unknown[]) {
      return statement(sql, values);
    },
    async run() {
      const info = db.prepare(sql).run(...(params as (string | number | null | bigint)[]));
      return { meta: { changes: Number(info.changes) } };
    },
    async all<T>() {
      const results = db.prepare(sql).all(...(params as (string | number | null | bigint)[])) as T[];
      return { results };
    },
    async first<T>() {
      const row = db.prepare(sql).get(...(params as (string | number | null | bigint)[])) as T | undefined;
      return row ?? null;
    },
  });

  return {
    prepare(sql: string) {
      return statement(sql, []);
    },
    async batch(statements: BoundStatement[]) {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const entry of statements) results.push(await entry.run());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
}
