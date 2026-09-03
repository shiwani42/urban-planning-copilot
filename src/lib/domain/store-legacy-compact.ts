/**
 * Strip legacy candidate geometry/provenance from store JSON *before* JSON.parse.
 * Pre-Pass-49 rows embed full parcel polygons in analysisResults[].candidates[],
 * which can OOM a 512 MB Render instance during parse/hydrate.
 */

const CANDIDATES_KEY = '"candidates"';
const STRIP_KEYS = new Set(["geometry", "provenance"]);

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\n" || ch === "\r" || ch === "\t";
}

function skipWhitespace(raw: string, index: number): number {
  let i = index;
  while (i < raw.length && isWhitespace(raw[i]!)) i++;
  return i;
}

function skipJsonString(raw: string, startQuote: number): number {
  let i = startQuote + 1;
  while (i < raw.length) {
    const ch = raw[i]!;
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === '"') return i + 1;
    i++;
  }
  throw new Error("Unterminated JSON string while compacting legacy store");
}

function skipJsonValue(raw: string, start: number): number {
  let i = skipWhitespace(raw, start);
  const ch = raw[i];
  if (ch === '"') return skipJsonString(raw, i);
  if (ch === "{") {
    let depth = 0;
    while (i < raw.length) {
      const c = raw[i]!;
      if (c === '"') {
        i = skipJsonString(raw, i);
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) return i + 1;
      }
      i++;
    }
    throw new Error("Unterminated JSON object while compacting legacy store");
  }
  if (ch === "[") {
    let depth = 0;
    while (i < raw.length) {
      const c = raw[i]!;
      if (c === '"') {
        i = skipJsonString(raw, i);
        continue;
      }
      if (c === "[") depth++;
      else if (c === "]") {
        depth--;
        if (depth === 0) return i + 1;
      }
      i++;
    }
    throw new Error("Unterminated JSON array while compacting legacy store");
  }
  if (ch === "t" && raw.startsWith("true", i)) return i + 4;
  if (ch === "f" && raw.startsWith("false", i)) return i + 5;
  if (ch === "n" && raw.startsWith("null", i)) return i + 4;
  if (ch === "-" || (ch >= "0" && ch <= "9")) {
    i++;
    while (i < raw.length && /[-+eE0-9.]/.test(raw[i]!)) i++;
    return i;
  }
  throw new Error(`Unexpected JSON token at ${i} while compacting legacy store`);
}

function parseJsonStringKey(raw: string, startQuote: number): string {
  const end = skipJsonString(raw, startQuote);
  return JSON.parse(raw.slice(startQuote, end)) as string;
}

function compactCandidateObject(raw: string, startBrace: number): { compacted: string; end: number } {
  let i = startBrace + 1;
  const parts: string[] = ["{"];
  let first = true;

  while (i < raw.length) {
    i = skipWhitespace(raw, i);
    if (raw[i] === "}") break;
    if (raw[i] === ",") {
      i++;
      continue;
    }

    const keyStart = i;
    if (raw[i] !== '"') {
      throw new Error("Expected candidate object key while compacting legacy store");
    }
    const keyName = parseJsonStringKey(raw, i);
    const keyEnd = skipJsonString(raw, i);

    i = skipWhitespace(raw, keyEnd);
    if (raw[i] !== ":") {
      throw new Error("Expected ':' after candidate key while compacting legacy store");
    }
    i++;
    i = skipWhitespace(raw, i);
    const valueEnd = skipJsonValue(raw, i);

    if (!STRIP_KEYS.has(keyName)) {
      if (!first) parts.push(",");
      first = false;
      parts.push(raw.slice(keyStart, valueEnd));
    }

    i = skipWhitespace(raw, valueEnd);
    if (raw[i] === ",") i++;
  }

  parts.push("}");
  return { compacted: parts.join(""), end: i + 1 };
}

function compactObjectsInArray(raw: string, startBracket: number): { compacted: string; end: number } {
  let i = startBracket + 1;
  const parts: string[] = ["["];
  let first = true;

  while (i < raw.length) {
    i = skipWhitespace(raw, i);
    if (raw[i] === "]") break;
    if (raw[i] === ",") {
      i++;
      continue;
    }
    if (raw[i] !== "{") {
      throw new Error("Expected object in candidates array while compacting legacy store");
    }
    const obj = compactCandidateObject(raw, i);
    if (!first) parts.push(",");
    first = false;
    parts.push(obj.compacted);
    i = skipWhitespace(raw, obj.end);
    if (raw[i] === ",") i++;
  }

  parts.push("]");
  return { compacted: parts.join(""), end: i + 1 };
}

function stripCandidateBloatFromStoreJson(raw: string): string {
  const parts: string[] = [];
  let cursor = 0;

  while (cursor < raw.length) {
    const found = raw.indexOf(CANDIDATES_KEY, cursor);
    if (found < 0) {
      parts.push(raw.slice(cursor));
      break;
    }

    parts.push(raw.slice(cursor, found));
    let i = found + CANDIDATES_KEY.length;
    i = skipWhitespace(raw, i);
    if (raw[i] !== ":") {
      parts.push(CANDIDATES_KEY);
      cursor = found + CANDIDATES_KEY.length;
      continue;
    }
    i++;
    i = skipWhitespace(raw, i);
    if (raw[i] !== "[") {
      parts.push(CANDIDATES_KEY);
      cursor = found + CANDIDATES_KEY.length;
      continue;
    }

    const array = compactObjectsInArray(raw, i);
    parts.push(CANDIDATES_KEY, ":", array.compacted);
    cursor = array.end;
  }

  return parts.join("");
}

/** Heuristic — true when candidates likely embed polygon geometry inline. */
export function storeJsonNeedsLegacyCompaction(raw: string): boolean {
  if (!raw.includes('"analysisResults"') || !raw.includes('"candidates"')) {
    return false;
  }
  if (!raw.includes('"geometry"')) return false;
  return /"geometry"\s*:\s*\{[\s\S]{0,80}"type"\s*:\s*"Polygon"/.test(raw);
}

/** Compact legacy inline candidate geometry/provenance before JSON.parse. */
export function compactLegacyStoreJsonBeforeParse(raw: string): {
  raw: string;
  changed: boolean;
} {
  if (!storeJsonNeedsLegacyCompaction(raw)) {
    return { raw, changed: false };
  }
  const compacted = stripCandidateBloatFromStoreJson(raw);
  return { raw: compacted, changed: compacted !== raw };
}

/** Compact an already-parsed payload (in-memory postgres / tests). */
export function compactLegacyPayloadInPlace(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const store = payload as { analysisResults?: unknown[] };
  if (!Array.isArray(store.analysisResults)) return false;

  let changed = false;
  for (const result of store.analysisResults) {
    if (!result || typeof result !== "object") continue;
    const row = result as { candidates?: unknown[] };
    if (!Array.isArray(row.candidates)) continue;
    row.candidates = row.candidates.map((candidate) => {
      if (!candidate || typeof candidate !== "object") return candidate;
      const c = candidate as Record<string, unknown>;
      if (!("geometry" in c) && !("provenance" in c)) return candidate;
      changed = true;
      const { geometry: _geometry, provenance: _provenance, centroid, ...rest } = c;
      return centroid !== undefined ? { ...rest, centroid } : rest;
    });
  }
  return changed;
}
