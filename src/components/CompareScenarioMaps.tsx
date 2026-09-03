"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Candidate, WorkspaceSnapshot } from "@/lib/domain/types";

const PlanningMap = dynamic(() => import("@/components/PlanningMap").then((m) => m.default), {
  ssr: false,
  loading: () => <div className="h-full bg-surface-container-low animate-pulse" />,
});

type Viewport = { center: [number, number]; zoom: number };

export type CompareMapEntry = {
  scenarioId: string;
  name: string;
  candidates: Candidate[];
  stale?: boolean;
};

const MAX_SYNCED_MAPS = 3;
export const COMPARE_SYNCED_MAP_LIMIT = MAX_SYNCED_MAPS;

export function CompareScenarioMaps({
  workspace,
  layerData,
  entries,
}: {
  workspace: WorkspaceSnapshot;
  layerData: Record<string, GeoJSON.FeatureCollection>;
  entries: CompareMapEntry[];
}) {
  const baseViewport = workspace.project.mapState.viewport;
  const [syncViewport, setSyncViewport] = useState<Viewport>({
    center: baseViewport.center,
    zoom: baseViewport.zoom,
  });
  const ignoreNextRef = useRef(0);

  const onViewportChange = useCallback((center: [number, number], zoom: number) => {
    if (Date.now() < ignoreNextRef.current) return;
    ignoreNextRef.current = Date.now() + 80;
    setSyncViewport({ center, zoom });
  }, []);

  const displayEntries = entries.slice(0, MAX_SYNCED_MAPS);
  const gridClass =
    displayEntries.length <= 1
      ? "grid-cols-1"
      : displayEntries.length === 2
        ? "grid-cols-1 md:grid-cols-2"
        : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3";

  const scenarioWorkspaces = useMemo(
    () =>
      displayEntries.map((entry) => ({
        entry,
        workspace: {
          ...workspace,
          project: {
            ...workspace.project,
            activeScenarioId: entry.scenarioId,
            mapState: {
              ...workspace.project.mapState,
              viewport: syncViewport,
            },
          },
        } satisfies WorkspaceSnapshot,
      })),
    [displayEntries, workspace, syncViewport]
  );

  if (displayEntries.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap justify-between items-center gap-2">
        <h3 className="text-headline-md text-on-surface">Spatial assessment</h3>
        <div
          className="flex items-center gap-2 px-3 py-1 bg-surface-container-low border border-outline-variant rounded"
          role="status"
        >
          <span className="material-symbols-outlined text-[16px] text-primary-container">sync</span>
          <span className="font-mono text-data-label text-on-surface-variant uppercase">
            Synchronized view · {displayEntries.length} map{displayEntries.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>
      <div
        className={`grid ${gridClass} gap-px bg-outline-variant border border-outline-variant rounded overflow-hidden h-[min(400px,42vh)]`}
      >
        {scenarioWorkspaces.map(({ entry, workspace: scenarioWorkspace }) => (
          <div key={entry.scenarioId} className="relative bg-surface min-h-[180px]">
            <div
              className="absolute top-2 left-2 z-[1002] glass-panel px-2 py-1 border border-outline-variant rounded font-mono text-data-label text-[10px] uppercase tracking-wide"
            >
              {entry.name}
            </div>
            <PlanningMap
              workspace={scenarioWorkspace}
              layerData={layerData}
              candidates={entry.candidates}
              onSelectCandidate={() => undefined}
              stale={entry.stale}
              controlledViewport={syncViewport}
              onViewportChange={onViewportChange}
              suppressGeoLabel
            />
          </div>
        ))}
      </div>
      {entries.length > MAX_SYNCED_MAPS && (
        <p className="text-caption text-on-surface-variant" role="note">
          Triple-map view shows the first three selected scenarios. Additional selections appear in
          the KPI matrix only.
        </p>
      )}
    </section>
  );
}
