/**
 * Carto/OSM raster basemap tiles for Leaflet (Pass 09).
 * Uses NEXT_PUBLIC_CARTO_API_KEY when set; otherwise Wikimedia OSM (no API key).
 * Do not use tile.openstreetmap.org as production CDN.
 */
export type BasemapStyle = "voyager" | "positron";

const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

const WIKIMEDIA_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://wikimediafoundation.org/wiki/Maps_Terms_of_Use">Wikimedia maps</a>';

export function cartoBasemapUrl(style: BasemapStyle = "voyager"): string {
  const key = process.env.NEXT_PUBLIC_CARTO_API_KEY?.trim();
  const base = `https://{s}.basemaps.cartocdn.com/rastertiles/${style}/{z}/{x}/{y}{r}.png`;
  if (key) {
    return `${base}?api_key=${encodeURIComponent(key)}`;
  }
  return "https://maps.wikimedia.org/osm-intl/{z}/{x}/{y}.png";
}

export function basemapAttribution(): string {
  const key = process.env.NEXT_PUBLIC_CARTO_API_KEY?.trim();
  return key ? CARTO_ATTRIBUTION : WIKIMEDIA_ATTRIBUTION;
}

export function basemapPolicyNote(): string {
  const key = process.env.NEXT_PUBLIC_CARTO_API_KEY?.trim();
  if (key) {
    return "Carto basemap with API key from NEXT_PUBLIC_CARTO_API_KEY.";
  }
  return "Wikimedia OSM basemap (no API key). For Carto Voyager tiles, set NEXT_PUBLIC_CARTO_API_KEY — free key at https://carto.com/basemaps/apikey";
}
