"use client";

import { useEffect, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  CircleMarker,
  useMap,
  Polygon,
} from "react-leaflet";
import type { WorkspaceSnapshot, Candidate, GeographicSelection } from "@/lib/domain/types";
import L from "leaflet";

function FitBounds({ bounds }: { bounds?: { west: number; south: number; east: number; north: number } }) {
  const map = useMap();
  useEffect(() => {
    if (!bounds) return;
    map.fitBounds(
      [
        [bounds.south, bounds.west],
        [bounds.north, bounds.east],
      ],
      { padding: [24, 24] }
    );
  }, [map, bounds]);
  return null;
}

function SyncViewport({
  center,
  zoom,
}: {
  center: [number, number];
  zoom: number;
}) {
  const map = useMap();
  useEffect(() => {
    map.setView([center[1], center[0]], zoom);
  }, [map, center, zoom]);
  return null;
}

type Props = {
  workspace: WorkspaceSnapshot;
  layerData: Record<string, GeoJSON.FeatureCollection>;
  candidates: Candidate[];
  onSelectCandidate: (c: Candidate) => void;
  onMapClickExclude?: (latlng: { lat: number; lng: number }) => void;
  drawingExclusion?: boolean;
};

export default function PlanningMap({
  workspace,
  layerData,
  candidates,
  onSelectCandidate,
  onMapClickExclude,
  drawingExclusion,
}: Props) {
  const { mapState } = workspace.project;
  const selectedId = mapState.selectedCandidateId;

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
        : "#ffffff",
      fillOpacity: candidate ? 0.55 : 0.15,
    };
  };

  return (
    <div className="absolute inset-0">
      <MapContainer
        center={[mapState.viewport.center[1], mapState.viewport.center[0]]}
        zoom={mapState.viewport.zoom}
        className="h-full w-full"
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url={
            process.env.NEXT_PUBLIC_CARTO_API_KEY
              ? `https://{s}.basemaps.cartocdn.com/rastertiles/positron/{z}/{x}/{y}{r}.png?key=${process.env.NEXT_PUBLIC_CARTO_API_KEY}`
              : "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
          }
          subdomains={process.env.NEXT_PUBLIC_CARTO_API_KEY ? "abcd" : undefined}
          maxZoom={20}
        />
        <FitBounds bounds={mapState.viewport.bounds} />
        <SyncViewport center={mapState.viewport.center} zoom={mapState.viewport.zoom} />

        {visibleKinds.has("flood") && layerData.flood && (
          <GeoJSON
            key={`flood-${layerData.flood.features.length}`}
            data={layerData.flood}
            style={(f) => ({
              color: "#005e7d",
              weight: 1,
              fillColor:
                f?.properties?.risk === "high" ? "#8ccff3" : "#c1e8ff",
              fillOpacity: 0.35,
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
              layer.on("click", () => {
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
                radius={5}
                pathOptions={{ color: "#00455d", fillColor: "#00455d", fillOpacity: 1 }}
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
                radius={6}
                pathOptions={{ color: "#815504", fillColor: "#fdc26c", fillOpacity: 0.9 }}
              />
            );
          })}

        {workspace.scenarios
          .find((s) => s.id === workspace.project.activeScenarioId)
          ?.geographicSelections.map((sel: GeographicSelection) => {
            const rings =
              sel.geometry.type === "Polygon"
                ? sel.geometry.coordinates
                : sel.geometry.coordinates[0];
            const positions = (rings[0] as number[][]).map(
              ([lng, lat]) => [lat, lng] as [number, number]
            );
            return (
              <Polygon
                key={sel.id}
                positions={positions}
                pathOptions={{
                  color: sel.type === "exclusion" ? "#ba1a1a" : "#815504",
                  fillOpacity: 0.2,
                  dashArray: "4 4",
                }}
              />
            );
          })}

        <ClickHandler
          enabled={Boolean(drawingExclusion)}
          onClick={(lat, lng) => onMapClickExclude?.({ lat, lng })}
        />
      </MapContainer>
    </div>
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
    const handler = (e: L.LeafletMouseEvent) => onClick(e.latlng.lat, e.latlng.lng);
    map.on("click", handler);
    map.getContainer().style.cursor = "crosshair";
    return () => {
      map.off("click", handler);
      map.getContainer().style.cursor = "";
    };
  }, [map, enabled, onClick]);
  return null;
}
