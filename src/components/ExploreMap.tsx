"use client";

import { useEffect, useRef } from "react";
import {
  MapContainer,
  GeoJSON,
  CircleMarker,
  useMap,
  ZoomControl,
  ScaleControl,
} from "react-leaflet";
import type { Candidate } from "@/lib/domain/types";
import type { ExploreAnalysisType } from "@/lib/domain/explore";
import { STUDY_BOUNDS } from "@/lib/domain/study-bounds";
import BasemapLayer from "@/components/BasemapLayer";
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
      { padding: [24, 24], maxZoom: 14 }
    );
    fitted.current = true;
  }, [map, bounds]);
  return null;
}

type LayerData = {
  parcels?: GeoJSON.FeatureCollection;
  transit?: GeoJSON.FeatureCollection;
  flood?: GeoJSON.FeatureCollection;
  schools?: GeoJSON.FeatureCollection;
};

type Props = {
  layerData: LayerData;
  candidates: Candidate[];
  selectedId?: string;
  analysisType: ExploreAnalysisType;
  onSelectCandidate: (c: Candidate) => void;
};

export function ExploreMap({
  layerData,
  candidates,
  selectedId,
  analysisType,
  onSelectCandidate,
}: Props) {
  const candidateIds = new Set(candidates.flatMap((c) => [c.id, ...c.featureIds]));

  const showTransit = analysisType === "transit_gap" || analysisType === "housing_siting";
  const showSchools = analysisType === "school_gap";
  const showFlood = analysisType === "flood_exposure";

  const parcelStyle = (feature?: GeoJSON.Feature) => {
    const id = String(feature?.properties?.id ?? feature?.id ?? "");
    const candidate = candidates.find((c) => c.id === id || c.featureIds.includes(id));
    const selected = selectedId === id || selectedId === candidate?.id;
    const inResults = candidateIds.has(id);
    return {
      color: selected ? "#00455d" : inResults ? "#005e7d" : "#c1c7ce",
      weight: selected ? 2.5 : 1,
      fillColor: candidate
        ? `rgba(0, 94, 125, ${0.2 + Math.min(candidate.score, 99) / 200})`
        : "#e8eef0",
      fillOpacity: candidate ? 0.6 : 0.25,
    };
  };

  return (
    <div className="relative h-[360px] rounded border border-outline-variant overflow-hidden">
      <div className="absolute inset-0 z-0 bg-surface-container-low" aria-hidden />
      <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[1001] pointer-events-none">
        <div className="bg-surface/95 border border-outline-variant px-3 py-1 rounded text-[10px] text-on-surface-variant font-medium whitespace-nowrap">
          San Francisco open data — Mission & SoMa demo area
        </div>
      </div>
      <MapContainer
        center={[
          (STUDY_BOUNDS.south + STUDY_BOUNDS.north) / 2,
          (STUDY_BOUNDS.west + STUDY_BOUNDS.east) / 2,
        ]}
        zoom={13}
        className="h-full w-full z-[1] bg-transparent"
        zoomControl={false}
        scrollWheelZoom
      >
        <ZoomControl position="topright" />
        <ScaleControl position="bottomleft" imperial={false} />
        <BasemapLayer />
        <FitBoundsOnce bounds={STUDY_BOUNDS} />

        {showFlood && layerData.flood && (
          <GeoJSON
            data={layerData.flood}
            interactive={false}
            style={(f) => ({
              color: "#005e7d",
              weight: 1,
              fillColor: f?.properties?.risk === "high" ? "#8ccff3" : "#c1e8ff",
              fillOpacity: 0.4,
            })}
          />
        )}

        {layerData.parcels && (
          <GeoJSON
            key={`parcels-${candidates.length}-${selectedId}`}
            data={layerData.parcels}
            style={parcelStyle}
            onEachFeature={(feature, layer) => {
              const id = String(feature.properties?.id ?? feature.id ?? "");
              const candidate = candidates.find(
                (c) => c.id === id || c.featureIds.includes(id)
              );
              if (candidate) {
                layer.on("click", (e) => {
                  L.DomEvent.stopPropagation(e);
                  onSelectCandidate(candidate);
                });
                layer.bindTooltip(`${candidate.label} — score ${candidate.score}`, {
                  sticky: true,
                });
              }
            }}
          />
        )}

        {showTransit &&
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
                  fillOpacity: 1,
                  weight: 2,
                }}
              />
            );
          })}

        {showSchools &&
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
                  fillOpacity: 0.95,
                  weight: 2,
                }}
              />
            );
          })}
      </MapContainer>
    </div>
  );
}
