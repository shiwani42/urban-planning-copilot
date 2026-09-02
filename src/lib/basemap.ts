/**
 * Carto/OSM raster basemap tiles for Leaflet (Pass 09).
 * Uses NEXT_PUBLIC_CARTO_API_KEY when set; otherwise Carto public CDN (no key).
 * Do not use tile.openstreetmap.org as production CDN.
 */
export type BasemapStyle = "voyager" | "positron";

const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

export function cartoBasemapUrl(style: BasemapStyle = "voyager"): string {
  const key = process.env.NEXT_PUBLIC_CARTO_API_KEY?.trim();
  const base = `https://{s}.basemaps.cartocdn.com/rastertiles/${style}/{z}/{x}/{y}{r}.png`;
  if (key) {
    return `${base}?api_key=${encodeURIComponent(key)}`;
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
  return "Carto public basemap CDN (no API key). For production rate limits, set NEXT_PUBLIC_CARTO_API_KEY — free key at https://carto.com/basemaps/apikey";
}
