"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  MapContainer,
  GeoJSON,
  CircleMarker,
  useMap,
  Polygon,
  ZoomControl,
  ScaleControl,
} from "react-leaflet";
import type { WorkspaceSnapshot, Candidate, GeographicSelection } from "@/lib/domain/types";
import { STUDY_BOUNDS } from "@/lib/domain/seed";
import L from "leaflet";

function FitBoundsOnce({
  bounds,
}: {
  bounds?: { west: number; south: number; east: number; north: number };
}) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (!bounds || fitted.current) return;
    map.fitBounds(
      [
        [bounds.south, bounds.west],
        [bounds.north, bounds.east],
      ],
      { padding: [32, 32], maxZoom: 15 }
    );
    fitted.current = true;
  }, [map, bounds]);
  return null;
}

function RestrictToStudyArea({
  bounds,
}: {
  bounds: { west: number; south: number; east: number; north: number };
}) {
  const map = useMap();
  useEffect(() => {
    const leafletBounds = L.latLngBounds(
      [bounds.south, bounds.west],
      [bounds.north, bounds.east]
    );
    map.setMaxBounds(leafletBounds.pad(0.05));
    map.setMinZoom(12);
    map.setMaxZoom(17);
  }, [map, bounds]);
  return null;
}

type Props = {
  workspace: WorkspaceSnapshot;
  layerData: Record<string, GeoJSON.FeatureCollection>;
  candidates: Candidate[];
  onSelectCandidate: (c: Candidate) => void;
  onMapClickExclude?: (latlng: { lat: number; lng: number }) => void;
  drawingExclusion?: boolean;
  excludeClicks?: [number, number][];
  stale?: boolean;
};

export default function PlanningMap({
  workspace,
  layerData,
  candidates,
  onSelectCandidate,
  onMapClickExclude,
  drawingExclusion,
  excludeClicks = [],
  stale = false,
}: Props) {
  const { mapState } = workspace.project;
  const selectedId = mapState.selectedCandidateId;
  const studyBounds = mapState.viewport.bounds ?? STUDY_BOUNDS;

  const visibleKinds = useMemo(() => {
    const ids = new Set(
      mapState.layers.filter((l) => l.visible).map((l) => l.datasetId)
    );
    return new Set(
      workspace.datasets.filter((d) => ids.has(d.id)).map((d) => d.kind)
    );
  }, [mapState.layers, workspace.datasets]);

  const parcelStyle = (feature?: GeoJSON.Feature) => {
    const id = String(feature?.properties?.id ?? feature?.id ?? "");
    const candidate = candidates.find((c) => c.id === id || c.featureIds.includes(id));
    const selected = selectedId === id || selectedId === candidate?.id;
    const rejected = candidate?.status === "rejected";
    const staleDim = stale && candidate ? 0.35 : 1;
    return {
      color: selected ? "#00455d" : rejected ? "#ba1a1a" : "#70787e",
      weight: selected ? 2.5 : 1,
      fillColor: candidate
        ? rejected
          ? "#ba1a1a"
          : `rgba(0, 94, 125, ${(0.15 + Math.min(candidate.score, 100) / 250) * staleDim})`
        : "#e8eef0",
      fillOpacity: candidate ? 0.55 * staleDim : 0.35,
      opacity: staleDim,
    };
  };

  const activeScenario = workspace.scenarios.find(
    (s) => s.id === workspace.project.activeScenarioId
  );

  const previewRing: [number, number][] | null =
    excludeClicks.length >= 2
      ? excludeClicks.map(([lng, lat]) => [lat, lng] as [number, number])
      : null;

  return (
    <div className="absolute inset-0">
      <div
        className="absolute inset-0 z-0"
        style={{
          background:
            "repeating-linear-gradient(0deg, #e8eef0 0px, #e8eef0 1px, #f4f7f8 1px, #f4f7f8 24px), repeating-linear-gradient(90deg, #e8eef0 0px, #e8eef0 1px, #f4f7f8 1px, #f4f7f8 24px)",
        }}
        aria-hidden
      />
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1001] pointer-events-none">
        <div className="bg-surface/95 border border-outline-variant px-4 py-1.5 rounded-full shadow-sm text-caption text-on-surface-variant font-medium whitespace-nowrap">
          Synthetic geography — not a real city
        </div>
      </div>
      <MapContainer
        center={[mapState.viewport.center[1], mapState.viewport.center[0]]}
        zoom={mapState.viewport.zoom}
        className="h-full w-full z-[1] bg-transparent"
        zoomControl={false}
        scrollWheelZoom
      >
        <ZoomControl position="topright" />
        <ScaleControl position="bottomleft" imperial={false} />
        <FitBoundsOnce bounds={studyBounds} />
        <RestrictToStudyArea bounds={studyBounds} />

        {visibleKinds.has("flood") && layerData.flood && (
          <GeoJSON
            key={`flood-${layerData.flood.features.length}`}
            data={layerData.flood}
            style={(f) => ({
              color: "#005e7d",
              weight: 1,
              fillColor: f?.properties?.risk === "high" ? "#8ccff3" : "#c1e8ff",
              fillOpacity: stale ? 0.2 : 0.4,
              opacity: stale ? 0.5 : 1,
            })}
          />
        )}

        {visibleKinds.has("parcels") && layerData.parcels && (
          <GeoJSON
            key={`parcels-${candidates.length}-${selectedId}-${stale}`}
            data={layerData.parcels}
            style={parcelStyle}
            onEachFeature={(feature, layer) => {
              const id = String(feature.properties?.id ?? feature.id ?? "");
              const candidate = candidates.find(
                (c) => c.id === id || c.featureIds.includes(id)
              );
              layer.on("click", (e) => {
                L.DomEvent.stopPropagation(e);
                if (candidate) onSelectCandidate(candidate);
              });
            }}
          />
        )}

        {visibleKinds.has("transit") &&
          layerData.transit?.features.map((f, i) => {
            const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
            return (
              <CircleMarker
                key={`t-${i}`}
                center={[lat, lng]}
                radius={6}
                pathOptions={{
                  color: "#00455d",
                  fillColor: "#005e7d",
                  fillOpacity: stale ? 0.5 : 1,
                  weight: 2,
                  opacity: stale ? 0.5 : 1,
                }}
              />
            );
          })}

        {visibleKinds.has("schools") &&
          layerData.schools?.features.map((f, i) => {
            const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
            return (
              <CircleMarker
                key={`s-${i}`}
                center={[lat, lng]}
                radius={7}
                pathOptions={{
                  color: "#815504",
                  fillColor: "#fdc26c",
                  fillOpacity: stale ? 0.5 : 0.95,
                  weight: 2,
                  opacity: stale ? 0.5 : 1,
                }}
              />
            );
          })}

        {visibleKinds.has("population") &&
          layerData.population?.features.map((f, i) => {
            const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
            const pop = Number(f.properties?.population ?? 100);
            const radius = Math.min(14, Math.max(3, Math.sqrt(pop) / 8));
            return (
              <CircleMarker
                key={`p-${i}`}
                center={[lat, lng]}
                radius={radius}
                pathOptions={{
                  color: "#70787e",
                  fillColor: "#bfc8ce",
                  fillOpacity: stale ? 0.25 : 0.45,
                  weight: 1,
                  opacity: stale ? 0.5 : 1,
                }}
              />
            );
          })}

        {visibleKinds.has("infrastructure") &&
          layerData.infrastructure?.features.map((f, i) => {
            const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
            return (
              <CircleMarker
                key={`i-${i}`}
                center={[lat, lng]}
                radius={4}
                pathOptions={{
                  color: "#565756",
                  fillColor: "#3f403f",
                  fillOpacity: stale ? 0.4 : 0.8,
                  weight: 1,
                  opacity: stale ? 0.5 : 1,
                }}
              />
            );
          })}

        {activeScenario?.geographicSelections.map((sel: GeographicSelection) => (
          <SelectionPolygon key={sel.id} selection={sel} />
        ))}

        {previewRing && (
          <Polygon
            positions={previewRing}
            pathOptions={{
              color: "#ba1a1a",
              fillColor: "#ba1a1a",
              fillOpacity: 0.12,
              weight: 2,
              dashArray: "6 4",
            }}
          />
        )}

        {excludeClicks.map(([lng, lat], i) => (
          <CircleMarker
            key={`ex-${i}`}
            center={[lat, lng]}
            radius={4}
            pathOptions={{ color: "#ba1a1a", fillColor: "#fff", fillOpacity: 1, weight: 2 }}
          />
        ))}

        <ClickHandler
          enabled={Boolean(drawingExclusion)}
          onClick={(lat, lng) => onMapClickExclude?.({ lat, lng })}
        />
      </MapContainer>
    </div>
  );
}

function SelectionPolygon({ selection }: { selection: GeographicSelection }) {
  const geom = selection.geometry;
  if (geom.type !== "Polygon") return null;
  const ring = geom.coordinates[0] as number[][];
  const positions = ring.map(([lng, lat]) => [lat, lng] as [number, number]);
  return (
    <Polygon
      positions={positions}
      pathOptions={{
        color: selection.type === "exclusion" ? "#ba1a1a" : "#815504",
        fillColor: selection.type === "exclusion" ? "#ba1a1a" : "#815504",
        fillOpacity: 0.15,
        weight: 2,
        dashArray: "6 4",
      }}
    />
  );
}

function ClickHandler({
  enabled,
  onClick,
}: {
  enabled: boolean;
  onClick: (lat: number, lng: number) => void;
}) {
  const map = useMap();
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(e);
      onClick(e.latlng.lat, e.latlng.lng);
    };
    map.on("click", handler);
    const container = map.getContainer();
    container.style.cursor = "crosshair";
    return () => {
      map.off("click", handler);
      container.style.cursor = "";
    };
  }, [map, enabled, onClick]);
  return null;
}

/** Legend entries for the workspace map overlay */
export function MapLegend({ visibleKinds }: { visibleKinds: Set<string> }) {
  const items: Array<{ label: string; swatch: ReactNode }> = [];
  if (visibleKinds.has("flood")) {
    items.push({
      label: "Flood risk",
      swatch: <div className="w-3 h-3 bg-[#8ccff3]/70 border border-[#005e7d]" />,
    });
  }
  if (visibleKinds.has("parcels")) {
    items.push({
      label: "Parcels / candidates",
      swatch: <div className="w-3 h-3 bg-primary/30 border border-primary" />,
    });
  }
  if (visibleKinds.has("transit")) {
    items.push({
      label: "Transit",
      swatch: <div className="w-2.5 h-2.5 bg-primary-container rounded-full" />,
    });
  }
  if (visibleKinds.has("schools")) {
    items.push({
      label: "Schools",
      swatch: <div className="w-2.5 h-2.5 bg-secondary-container rounded-full border border-secondary" />,
    });
  }
  if (visibleKinds.has("population")) {
    items.push({
      label: "Population",
      swatch: <div className="w-3 h-3 bg-outline-variant/50 rounded-full" />,
    });
  }
  if (visibleKinds.has("infrastructure")) {
    items.push({
      label: "Infrastructure",
      swatch: <div className="w-2 h-2 bg-tertiary rounded-sm" />,
    });
  }
  if (items.length === 0) {
    items.push({
      label: "No layers visible",
      swatch: <div className="w-3 h-3 border border-outline-variant" />,
    });
  }
  return (
    <div className="space-y-1.5 text-caption">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2">
          {item.swatch}
          {item.label}
        </div>
      ))}
    </div>
  );
}
