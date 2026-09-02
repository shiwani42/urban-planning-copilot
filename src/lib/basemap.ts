/**
 * Carto/OSM raster basemap tiles for Leaflet.
 * Uses NEXT_PUBLIC_CARTO_API_KEY when set (`?key=...` per Carto docs).
 * Without a key, uses the same Carto CDN URL without the query param.
 */
export type BasemapStyle = "voyager" | "positron";

const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>';

export function cartoBasemapUrl(style: BasemapStyle = "voyager"): string {
  const key = process.env.NEXT_PUBLIC_CARTO_API_KEY?.trim();
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
  const key = process.env.NEXT_PUBLIC_CARTO_API_KEY?.trim();
  if (key) {
    return "Carto basemap with API key from NEXT_PUBLIC_CARTO_API_KEY.";
  }
  return "Carto basemap without API key query param. Set NEXT_PUBLIC_CARTO_API_KEY for authenticated tiles — free key at https://carto.com/basemaps/apikey";
}
