// In-memory mock of the RegistryClient (Supabase service-role client slice)
// + SqlExecutor for appfactory unit tests. No real DB anywhere.

import type {
  RegistryClient,
  RegistryFilter,
  RegistryTable,
  SqlExecutor,
} from '../types.js';

export interface MockDb {
  tables: Record<string, Record<string, unknown>[]>;
  /** table -> op ('insert'|'update'|'delete') that should fail. */
  failOn: Set<string>;
  /** ordered log of "op:table" for assertion of sequencing. */
  ops: string[];
}

export function makeDb(): MockDb {
  return { tables: { tenant_apps: [], app_events: [] }, failOn: new Set(), ops: [] };
}

type Op = 'insert' | 'update' | 'delete' | 'select';

class MockFilter implements RegistryFilter {
  private filters: Array<[string, unknown]> = [];

  constructor(
    private db: MockDb,
    private table: string,
    private op: Op,
    private values?: Record<string, unknown>,
  ) {}

  eq(column: string, value: unknown): RegistryFilter {
    this.filters.push([column, value]);
    return this;
  }

  select(): RegistryFilter {
    return this;
  }

  private run(): { rows: Record<string, unknown>[]; error: { message: string } | null } {
    const key = `${this.op}:${this.table}`;
    this.db.ops.push(key);
    if (this.db.failOn.has(key)) return { rows: [], error: { message: `forced failure ${key}` } };

    const all = this.db.tables[this.table] ?? [];
    const match = (r: Record<string, unknown>) => this.filters.every(([c, v]) => r[c] === v);
    switch (this.op) {
      case 'insert': {
        all.push({ ...this.values });
        return { rows: [{ ...this.values }], error: null };
      }
      case 'update': {
        const hit = all.filter(match);
        for (const r of hit) Object.assign(r, this.values);
        return { rows: hit, error: null };
      }
      case 'delete': {
        this.db.tables[this.table] = all.filter((r) => !match(r));
        return { rows: [], error: null };
      }
      case 'select':
        return { rows: all.filter(match), error: null };
    }
  }

  single(): PromiseLike<{ data: unknown; error: { message: string } | null }> {
    const { rows, error } = this.run();
    if (error) return Promise.resolve({ data: null, error });
    return Promise.resolve({
      data: rows[0] ?? null,
      error: rows[0] ? null : { message: 'no rows' },
    });
  }

  maybeSingle(): PromiseLike<{ data: unknown; error: { message: string } | null }> {
    const { rows, error } = this.run();
    return Promise.resolve({ data: rows[0] ?? null, error });
  }

  then<R>(
    onfulfilled?: (value: { data: unknown; error: { message: string } | null }) => R,
  ): PromiseLike<R> {
    const { rows, error } = this.run();
    return Promise.resolve({ data: rows, error }).then(onfulfilled);
  }
}

class MockTable implements RegistryTable {
  constructor(
    private db: MockDb,
    private table: string,
  ) {}

  insert(values: Record<string, unknown>): RegistryFilter {
    return new MockFilter(this.db, this.table, 'insert', values);
  }
  update(values: Record<string, unknown>): RegistryFilter {
    return new MockFilter(this.db, this.table, 'update', values);
  }
  delete(): RegistryFilter {
    return new MockFilter(this.db, this.table, 'delete');
  }
  select(): RegistryFilter {
    return new MockFilter(this.db, this.table, 'select');
  }
}

export function makeRegistry(db: MockDb): RegistryClient {
  return { from: (table: string) => new MockTable(db, table) };
}

export function makeSql(opts: { fail?: boolean } = {}): SqlExecutor & { executed: string[] } {
  const executed: string[] = [];
  return {
    executed,
    async exec(sql: string) {
      if (opts.fail) throw new Error('forced SQL failure');
      executed.push(sql);
    },
  };
}
