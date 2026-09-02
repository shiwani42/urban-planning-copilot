/** Map layer colors — shared by legend and layer checkboxes. */
export const LAYER_SWATCH: Record<string, { className: string; label: string }> = {
  flood: {
    label: "Flood risk",
    className: "bg-[#8ccff3]/70 border border-[#005e7d]",
  },
  parcels: {
    label: "Parcels",
    className: "bg-primary/30 border border-primary",
  },
  transit: {
    label: "Transit",
    className: "bg-primary-container rounded-full",
  },
  schools: {
    label: "Schools",
    className: "bg-secondary-container rounded-full border border-secondary",
  },
  population: {
    label: "Population",
    className: "bg-outline-variant/50 rounded-full",
  },
  parks: {
    label: "Parks",
    className: "bg-tertiary-container rounded-full border border-tertiary",
  },
  infrastructure: {
    label: "Infrastructure",
    className: "bg-tertiary rounded-sm",
  },
};

export function layerSwatch(kind: string): { className: string; label: string } {
  return (
    LAYER_SWATCH[kind] ?? {
      label: kind,
      className: "bg-surface-container-high border border-outline-variant",
    }
  );
}
