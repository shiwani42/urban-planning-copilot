/** Checked-in Mission/SoMa street map — used on project cards, not loaded from a tile CDN at runtime. */
export const MISSION_SOMA_MAP_THUMB = "/maps/mission-soma.webp";

/** Static map preview for a study card. All live studies are Mission/SoMa. */
export function projectMapThumbSrc(_geographyLabel?: string | null): string {
  return MISSION_SOMA_MAP_THUMB;
}
