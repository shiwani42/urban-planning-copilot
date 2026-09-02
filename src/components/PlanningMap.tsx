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
  Marker,
} from "react-leaflet";
import type { WorkspaceSnapshot, Candidate, GeographicSelection } from "@/lib/domain/types";
import { featureIdsInExclusions, ringFromPolygon } from "@/lib/domain/geographic";
import { STUDY_BOUNDS } from "@/lib/domain/seed";
import L from "leaflet";

export type MapDrawMode = "none" | "exclude" | "include" | "edit";

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
  drawMode?: MapDrawMode;
  drawClicks?: [number, number][];
  editingSelectionId?: string | null;
  onMapClickDraw?: (latlng: { lat: number; lng: number }) => void;
  onVertexDrag?: (index: number, lat: number, lng: number) => void;
  onSelectGeographic?: (selection: GeographicSelection) => void;
  stale?: boolean;
};

export default function PlanningMap({
  workspace,
  layerData,
  candidates,
  onSelectCandidate,
  drawMode = "none",
  drawClicks = [],
  editingSelectionId = null,
  onMapClickDraw,
  onVertexDrag,
  onSelectGeographic,
  stale = false,
}: Props) {
  const { mapState } = workspace.project;
  const selectedId = mapState.selectedCandidateId;
  const studyBounds = mapState.viewport.bounds ?? STUDY_BOUNDS;
  const drawingActive = drawMode !== "none";

  const visibleKinds = useMemo(() => {
    const ids = new Set(
      mapState.layers.filter((l) => l.visible).map((l) => l.datasetId)
    );
    return new Set(
      workspace.datasets.filter((d) => ids.has(d.id)).map((d) => d.kind)
    );
  }, [mapState.layers, workspace.datasets]);

  const activeScenario = workspace.scenarios.find(
    (s) => s.id === workspace.project.activeScenarioId
  );

  const excludedFeatureIds = useMemo(() => {
    if (!layerData.parcels || !activeScenario) return new Set<string>();
    return featureIdsInExclusions(
      layerData.parcels.features,
      activeScenario.geographicSelections
    );
  }, [layerData.parcels, activeScenario?.geographicSelections]);

  const editingSelection = useMemo(() => {
    if (!editingSelectionId || !activeScenario) return null;
    return activeScenario.geographicSelections.find((s) => s.id === editingSelectionId) ?? null;
  }, [editingSelectionId, activeScenario]);

  const editVertices = useMemo((): [number, number][] => {
    if (drawMode === "edit" && drawClicks.length >= 1) {
      return drawClicks;
    }
    if (editingSelection) {
      return ringFromPolygon(editingSelection.geometry) as [number, number][];
    }
    return [];
  }, [drawMode, drawClicks, editingSelection]);

  const parcelStyle = (feature?: GeoJSON.Feature) => {
    const id = String(feature?.properties?.id ?? feature?.id ?? "");
    const candidate = candidates.find((c) => c.id === id || c.featureIds.includes(id));
    const selected = selectedId === id || selectedId === candidate?.id;
    const rejected = candidate?.status === "rejected";
    const geoExcluded = excludedFeatureIds.has(id);
    const staleDim = stale && candidate ? 0.35 : 1;

    if (geoExcluded && !drawingActive) {
      return {
        color: "#ba1a1a",
        weight: selected ? 2.5 : 1.5,
        fillColor: "#ba1a1a",
        fillOpacity: 0.28 * staleDim,
        opacity: 0.85 * staleDim,
        dashArray: "4 3",
      };
    }

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

  const previewRing: [number, number][] | null =
    drawMode !== "edit" && drawClicks.length >= 2
      ? drawClicks.map(([lng, lat]) => [lat, lng] as [number, number])
      : drawMode === "edit" && editVertices.length >= 2
        ? editVertices.map(([lng, lat]) => [lat, lng] as [number, number])
        : null;

  const previewColor = drawMode === "include" ? "#815504" : "#ba1a1a";

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
        doubleClickZoom={!drawingActive}
      >
        <ZoomControl position="topright" />
        <ScaleControl position="bottomleft" imperial={false} />
        <FitBoundsOnce bounds={studyBounds} />
        <RestrictToStudyArea bounds={studyBounds} />
        <DrawModeHandler enabled={drawingActive} />

        {visibleKinds.has("flood") && layerData.flood && (
          <GeoJSON
            key={`flood-${layerData.flood.features.length}`}
            data={layerData.flood}
            interactive={false}
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
            key={`parcels-${candidates.length}-${selectedId}-${stale}-${excludedFeatureIds.size}-${drawingActive}`}
            data={layerData.parcels}
            style={parcelStyle}
            interactive={!drawingActive}
            onEachFeature={(feature, layer) => {
              if (drawingActive) return;
              const id = String(feature.properties?.id ?? feature.id ?? "");
              const candidate = candidates.find(
                (c) => c.id === id || c.featureIds.includes(id)
              );
              const geoExcluded = excludedFeatureIds.has(id);
              if (candidate) {
                layer.on("click", (e) => {
                  L.DomEvent.stopPropagation(e);
                  onSelectCandidate(candidate);
                });
                const tooltip = geoExcluded
                  ? `${candidate.label} (geographically excluded)`
                  : candidate.label;
                layer.bindTooltip(tooltip, { sticky: true });
              } else if (geoExcluded) {
                layer.bindTooltip("Geographically excluded parcel", { sticky: true });
              }
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
                interactive={false}
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
                interactive={false}
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
                interactive={false}
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
                interactive={false}
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

        {activeScenario?.geographicSelections.map((sel: GeographicSelection) => {
          if (drawMode === "edit" && sel.id === editingSelectionId) return null;
          return (
            <SelectionPolygon
              key={sel.id}
              selection={sel}
              interactive={!drawingActive}
              highlighted={sel.id === editingSelectionId}
              onSelect={() => onSelectGeographic?.(sel)}
            />
          );
        })}

        {previewRing && (
          <Polygon
            positions={previewRing}
            pathOptions={{
              color: previewColor,
              fillColor: previewColor,
              fillOpacity: 0.12,
              weight: 2,
              dashArray: "6 4",
            }}
          />
        )}

        {(drawMode === "edit" ? editVertices : drawClicks).map(([lng, lat], i) => (
          <VertexHandle
            key={`vx-${i}-${lng}-${lat}`}
            index={i}
            lat={lat}
            lng={lng}
            color={previewColor}
            draggable={drawMode === "edit"}
            onDrag={onVertexDrag}
          />
        ))}

        <ClickHandler
          enabled={drawMode === "exclude" || drawMode === "include"}
          onClick={(lat, lng) => onMapClickDraw?.({ lat, lng })}
        />
      </MapContainer>
    </div>
  );
}

function SelectionPolygon({
  selection,
  interactive,
  highlighted,
  onSelect,
}: {
  selection: GeographicSelection;
  interactive?: boolean;
  highlighted?: boolean;
  onSelect?: () => void;
}) {
  const geom = selection.geometry;
  if (geom.type !== "Polygon") return null;
  const ring = geom.coordinates[0] as number[][];
  const positions = ring.map(([lng, lat]) => [lat, lng] as [number, number]);
  const isExclusion = selection.type === "exclusion";
  const color = isExclusion ? "#ba1a1a" : "#815504";

  return (
    <Polygon
      positions={positions}
      pathOptions={{
        color: highlighted ? "#00455d" : color,
        fillColor: color,
        fillOpacity: highlighted ? 0.22 : 0.15,
        weight: highlighted ? 3 : 2,
        dashArray: "6 4",
      }}
      eventHandlers={
        interactive && onSelect
          ? {
              click: (e) => {
                L.DomEvent.stopPropagation(e);
                onSelect();
              },
            }
          : undefined
      }
    />
  );
}

function VertexHandle({
  index,
  lat,
  lng,
  color,
  draggable,
  onDrag,
}: {
  index: number;
  lat: number;
  lng: number;
  color: string;
  draggable?: boolean;
  onDrag?: (index: number, lat: number, lng: number) => void;
}) {
  const icon = L.divIcon({
    className: "",
    html: `<div style="width:10px;height:10px;border-radius:50%;background:#fff;border:2px solid ${color};box-shadow:0 0 0 1px rgba(0,0,0,0.2)"></div>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });

  const eventHandlers = useMemo(
    () =>
      draggable
        ? {
            dragend: (e: L.LeafletEvent) => {
              const marker = e.target as L.Marker;
              const pos = marker.getLatLng();
              onDrag?.(index, pos.lat, pos.lng);
            },
          }
        : undefined,
    [draggable, index, onDrag]
  );

  return (
    <Marker
      position={[lat, lng]}
      icon={icon}
      draggable={Boolean(draggable)}
      eventHandlers={eventHandlers}
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
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;

  useEffect(() => {
    if (!enabled) return;
    const handler = (e: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(e);
      onClickRef.current(e.latlng.lat, e.latlng.lng);
    };
    const dblHandler = (e: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(e);
    };
    map.on("click", handler);
    map.on("dblclick", dblHandler);
    const container = map.getContainer();
    container.style.cursor = "crosshair";
    return () => {
      map.off("click", handler);
      map.off("dblclick", dblHandler);
      container.style.cursor = "";
    };
  }, [map, enabled]);
  return null;
}

function DrawModeHandler({ enabled }: { enabled: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (enabled) {
      map.doubleClickZoom.disable();
    } else {
      map.doubleClickZoom.enable();
    }
  }, [map, enabled]);
  return null;
}

/** Legend entries for the workspace map overlay */
export function MapLegend({
  visibleKinds,
  hasExclusions,
}: {
  visibleKinds: Set<string>;
  hasExclusions?: boolean;
}) {
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
  if (hasExclusions) {
    items.push({
      label: "Geographically excluded",
      swatch: (
        <div
          className="w-3 h-3 border border-[#ba1a1a]"
          style={{
            background:
              "repeating-linear-gradient(135deg, #ba1a1a33 0, #ba1a1a33 2px, transparent 2px, transparent 4px)",
          }}
        />
      ),
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
      swatch: (
        <div className="w-2.5 h-2.5 bg-secondary-container rounded-full border border-secondary" />
      ),
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
