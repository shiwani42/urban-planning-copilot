import { neon } from "@neondatabase/serverless";
import type { AppStore } from "./types";
import { prepareStoreForPersistence } from "./store-persistence";
import { projectCountFromRawJson } from "./store-shape";

const STORE_ROW_ID = "default";

export type SqlTag = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Record<string, unknown>[]>;

export type PostgresPersistOptions = {
  /** Allow replacing a non-empty catalog with zero projects (tests / explicit wipe). */
  allowEmptyCatalog?: boolean;
};

export class PostgresPersistError extends Error {
  readonly code = "STORE_PERSIST_FAILED" as const;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "PostgresPersistError";
    if (options?.cause) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

type InMemoryPostgresRow = {
  payload: unknown;
  updated_at: string;
};

let sqlOverride: SqlTag | null = null;
let useInMemoryBackend = false;
let inMemoryRow: InMemoryPostgresRow | null = null;
let tableEnsured = false;

export function isPostgresConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getPersistBackend(): "postgres" | "file" {
  return isPostgresConfigured() ? "postgres" : "file";
}

/** Test hook — inject a mock tagged-template SQL client. */
export function setSqlClientForTests(sql: SqlTag | null): void {
  sqlOverride = sql;
}

/** Test hook — use an in-memory row instead of a real database. */
export function enableInMemoryPostgresForTests(): void {
  useInMemoryBackend = true;
  inMemoryRow = null;
  tableEnsured = false;
}

export function resetPostgresBackendForTests(): void {
  sqlOverride = null;
  useInMemoryBackend = false;
  inMemoryRow = null;
  tableEnsured = false;
}

function usingInMemoryPostgres(): boolean {
  return useInMemoryBackend;
}

function getSql(): SqlTag {
  if (sqlOverride) return sqlOverride;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new PostgresPersistError("DATABASE_URL is not set");
  }
  return neon(url) as SqlTag;
}

function payloadToRaw(payload: unknown): string {
  if (typeof payload === "string") return payload;
  return JSON.stringify(payload);
}

export async function ensurePlanningStoreTable(): Promise<void> {
  if (usingInMemoryPostgres()) {
    tableEnsured = true;
    return;
  }
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS planning_store (
      id text PRIMARY KEY,
      payload jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  tableEnsured = true;
}

export async function loadStorePayloadFromPostgres(): Promise<string | null> {
  await ensurePlanningStoreTable();

  if (usingInMemoryPostgres()) {
    if (!inMemoryRow) return null;
    return payloadToRaw(inMemoryRow.payload);
  }

  const sql = getSql();
  const rows = await sql`
    SELECT payload
    FROM planning_store
    WHERE id = ${STORE_ROW_ID}
    LIMIT 1
  `;
  if (!rows.length) return null;
  const payload = (rows[0] as { payload?: unknown }).payload;
  if (payload === undefined || payload === null) return null;
  return payloadToRaw(payload);
}

export async function peekPostgresProjectCount(): Promise<number | null> {
  const raw = await loadStorePayloadFromPostgres();
  if (raw === null) return null;
  return projectCountFromRawJson(raw);
}

export async function assertNotClobberingNonemptyPostgresCatalog(
  store: AppStore,
  options?: PostgresPersistOptions
): Promise<void> {
  if (options?.allowEmptyCatalog) return;
  if (store.projects.length > 0) return;
  const existingCount = await peekPostgresProjectCount();
  if (existingCount !== null && existingCount > 0) {
    const message = `Refusing to persist empty catalog over postgres store with ${existingCount} project(s)`;
    console.error(`[store] ${message}`);
    throw new PostgresPersistError(message);
  }
}

export async function upsertStoreToPostgres(
  store: AppStore,
  options?: PostgresPersistOptions
): Promise<void> {
  await assertNotClobberingNonemptyPostgresCatalog(store, options);
  const compact = prepareStoreForPersistence(store);
  const payloadJson = JSON.stringify(compact);
  if (!payloadJson.trim()) {
    throw new PostgresPersistError("Refusing to persist empty store payload");
  }

  await ensurePlanningStoreTable();

  if (usingInMemoryPostgres()) {
    inMemoryRow = {
      payload: JSON.parse(payloadJson) as unknown,
      updated_at: new Date().toISOString(),
    };
    return;
  }

  const sql = getSql();
  await sql`
    INSERT INTO planning_store (id, payload, updated_at)
    VALUES (${STORE_ROW_ID}, ${compact}::jsonb, now())
    ON CONFLICT (id) DO UPDATE SET
      payload = EXCLUDED.payload,
      updated_at = now()
  `;
}

export async function verifyPostgresWritable(): Promise<void> {
  await ensurePlanningStoreTable();
  if (usingInMemoryPostgres()) return;
  const sql = getSql();
  await sql`SELECT 1 AS ok`;
}
