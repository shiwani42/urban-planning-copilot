/**
 * Carto/OSM raster basemap tiles for Leaflet.
 * Tile URLs use `?key=` (Carto docs) — never `api_key` or a `{r}` retina suffix.
 * The key is read from several env names so a Render secret still works even
 * when Next did not inline NEXT_PUBLIC_* at build time.
 */
export type BasemapStyle = "voyager" | "positron";

const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>';

const KEY_ENV_NAMES = [
  "NEXT_PUBLIC_CARTO_API_KEY",
  "CARTO_API_KEY",
  "CARTO_BASMAP_API_KEY",
] as const;

export function resolveCartoApiKey(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  for (const name of KEY_ENV_NAMES) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function cartoBasemapUrl(
  style: BasemapStyle = "voyager",
  env: NodeJS.ProcessEnv = process.env
): string {
  const key = resolveCartoApiKey(env);
  const base = `https://{s}.basemaps.cartocdn.com/rastertiles/${style}/{z}/{x}/{y}.png`;
  if (key) {
    return `${base}?key=${encodeURIComponent(key)}`;
  }
  return base;
}

export function basemapAttribution(): string {
  return CARTO_ATTRIBUTION;
}

export function basemapPolicyNote(): string {
  const key = resolveCartoApiKey();
  if (key) {
    return "Carto basemap with API key from environment.";
  }
  return "Carto basemap without API key query param. Set NEXT_PUBLIC_CARTO_API_KEY or CARTO_API_KEY — free key at https://carto.com/basemaps/apikey";
}
