declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      run(...params: Array<string | number | bigint | null>): { changes: number | bigint };
      all(...params: Array<string | number | bigint | null>): unknown[];
      get(...params: Array<string | number | bigint | null>): unknown;
    };
  }
}

declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
}
