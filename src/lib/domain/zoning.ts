/**
 * Parcel zoning used by analysis filters and the map overlay.
 * Matches ingest (`scripts/ingest-sf-open-data.mjs`) and synthetic seed land_use.
 */

const SF_RESIDENTIAL_ZONING_RE = /^(RH|RM|RC|RPD|RTO|RED|RES|NCT|R\d)/i;
const MIXED_USE_ZONING_RE = /^(MX|MU)/i;

export function isResidentialParcel(feature?: GeoJSON.Feature | null): boolean {
  if (!feature) return false;
  const props = (feature.properties ?? {}) as Record<string, unknown>;
  if (String(props.land_use ?? "") === "residential") return true;
  const zoning = String(props.zoning ?? props.zoning_code ?? "");
  if (SF_RESIDENTIAL_ZONING_RE.test(zoning) || MIXED_USE_ZONING_RE.test(zoning)) return true;
  return /RESIDENTIAL/i.test(String(props.zoning_district ?? ""));
}

export function parcelZoningLabel(feature?: GeoJSON.Feature | null): string {
  const props = (feature?.properties ?? {}) as Record<string, unknown>;
  const code = String(props.zoning_code ?? props.zoning ?? "").trim();
  const district = String(props.zoning_district ?? "").trim();
  if (code && district && district.toLowerCase() !== code.toLowerCase()) {
    return `${code} — ${district}`;
  }
  if (code) return code;
  if (district) return district;
  return isResidentialParcel(feature) ? "Residential zoning" : "Other zoning";
}
