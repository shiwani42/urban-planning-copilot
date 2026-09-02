"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  CircleMarker,
  useMap,
  Polygon,
  ZoomControl,
  ScaleControl,
} from "react-leaflet";
import type { WorkspaceSnapshot, Candidate, GeographicSelection } from "@/lib/domain/types";
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
      { padding: [24, 24] }
    );
    fitted.current = true;
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
};

function tileConfig(): { url: string; attribution: string; subdomains?: string } {
  const cartoKey = process.env.NEXT_PUBLIC_CARTO_API_KEY;
  if (cartoKey) {
    return {
      url: `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=${cartoKey}`,
      subdomains: "abcd",
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    };
  }
  return {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    subdomains: "abc",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  };
}

export default function PlanningMap({
  workspace,
  layerData,
  candidates,
  onSelectCandidate,
  onMapClickExclude,
  drawingExclusion,
  excludeClicks = [],
}: Props) {
  const { mapState } = workspace.project;
  const selectedId = mapState.selectedCandidateId;
  const tiles = tileConfig();

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
    return {
      color: selected ? "#00455d" : rejected ? "#ba1a1a" : "#70787e",
      weight: selected ? 2.5 : 1,
      fillColor: candidate
        ? rejected
          ? "#ba1a1a"
          : `rgba(0, 94, 125, ${0.15 + Math.min(candidate.score, 100) / 250})`
        : "#e8eef0",
      fillOpacity: candidate ? 0.55 : 0.35,
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
      <MapContainer
        center={[mapState.viewport.center[1], mapState.viewport.center[0]]}
        zoom={mapState.viewport.zoom}
        className="h-full w-full z-0"
        zoomControl={false}
        scrollWheelZoom
      >
        <TileLayer
          attribution={tiles.attribution}
          url={tiles.url}
          subdomains={tiles.subdomains}
          maxZoom={20}
        />
        <ZoomControl position="topright" />
        <ScaleControl position="bottomleft" imperial={false} />
        <FitBoundsOnce bounds={mapState.viewport.bounds} />

        {visibleKinds.has("flood") && layerData.flood && (
          <GeoJSON
            key={`flood-${layerData.flood.features.length}`}
            data={layerData.flood}
            style={(f) => ({
              color: "#005e7d",
              weight: 1,
              fillColor: f?.properties?.risk === "high" ? "#8ccff3" : "#c1e8ff",
              fillOpacity: 0.4,
            })}
          />
        )}

        {visibleKinds.has("parcels") && layerData.parcels && (
          <GeoJSON
            key={`parcels-${candidates.length}-${selectedId}`}
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
                pathOptions={{ color: "#00455d", fillColor: "#005e7d", fillOpacity: 1, weight: 2 }}
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
                pathOptions={{ color: "#815504", fillColor: "#fdc26c", fillOpacity: 0.95, weight: 2 }}
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
                  fillOpacity: 0.45,
                  weight: 1,
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
                  fillOpacity: 0.8,
                  weight: 1,
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
