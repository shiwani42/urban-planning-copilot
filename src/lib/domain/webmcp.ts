import { z } from "zod";
import * as services from "./services";
import { getStore } from "./store";
import { normalizeWeights } from "./objective";

/**
 * WebMCP — semantic planning tools operating on shared domain state.
 * No DOM selectors, coordinates, or UI scraping.
 */

export const toolDefinitions = [
  {
    name: "getWorkspaceState",
    description: "Get the full workspace snapshot for a project",
    inputSchema: z.object({ projectId: z.string() }),
  },
  {
    name: "listProjects",
    description: "List all planning projects",
    inputSchema: z.object({}),
  },
  {
    name: "createProject",
    description: "Create a project with a natural-language planning objective",
    inputSchema: z.object({
      name: z.string().min(1),
      objectiveText: z.string().min(1),
      geographyLabel: z.string().optional(),
      mode: z.enum(["explore", "planning"]).optional(),
    }),
  },
  {
    name: "updatePlanningObjective",
    description: "Update the active scenario planning objective from natural language",
    inputSchema: z.object({
      projectId: z.string(),
      objectiveText: z.string().min(1),
    }),
  },
  {
    name: "getMapState",
    description: "Get map viewport, layers, and selection state",
    inputSchema: z.object({ projectId: z.string() }),
  },
  {
    name: "setMapViewport",
    description: "Update map center/zoom",
    inputSchema: z.object({
      projectId: z.string(),
      center: z.tuple([z.number(), z.number()]),
      zoom: z.number(),
    }),
  },
  {
    name: "toggleLayer",
    description: "Toggle dataset layer visibility on the map",
    inputSchema: z.object({
      projectId: z.string(),
      datasetId: z.string(),
      visible: z.boolean(),
    }),
  },
  {
    name: "selectFeatures",
    description: "Select features / candidate on the map",
    inputSchema: z.object({
      projectId: z.string(),
      featureIds: z.array(z.string()),
      candidateId: z.string().optional(),
    }),
  },
  {
    name: "highlightFeatures",
    description: "Highlight features without changing primary selection",
    inputSchema: z.object({
      projectId: z.string(),
      featureIds: z.array(z.string()),
    }),
  },
  {
    name: "createGeographicSelection",
    description: "Add an exclusion/inclusion polygon to planning state",
    inputSchema: z.object({
      projectId: z.string(),
      scenarioId: z.string(),
      type: z.enum(["exclusion", "inclusion", "focus"]),
      label: z.string(),
      geometry: z.any(),
      createdBy: z.enum(["human", "agent"]).default("agent"),
    }),
  },
  {
    name: "listAvailableLayers",
    description: "List datasets/layers with metadata",
    inputSchema: z.object({}),
  },
  {
    name: "queryLayer",
    description: "Return GeoJSON features for a dataset",
    inputSchema: z.object({ datasetId: z.string() }),
  },
  {
    name: "inspectFeature",
    description: "Inspect a single feature by id within a dataset",
    inputSchema: z.object({
      datasetId: z.string(),
      featureId: z.string(),
    }),
  },
  {
    name: "updatePlanningCriteria",
    description: "Update constraints and/or weights for a scenario",
    inputSchema: z.object({
      projectId: z.string(),
      scenarioId: z.string(),
      constraints: z.array(z.any()).optional(),
      weights: z
        .array(
          z.object({
            id: z.string().optional(),
            key: z.string(),
            label: z.string(),
            weight: z.number().min(0).max(1),
          })
        )
        .optional(),
      transitThresholdMeters: z.number().positive().optional(),
    }),
  },
  {
    name: "runSpatialFilter",
    description: "Run (or re-run) full spatial analysis for a scenario",
    inputSchema: z.object({
      projectId: z.string(),
      scenarioId: z.string(),
    }),
  },
  {
    name: "calculateProximity",
    description: "Alias for running analysis emphasizing proximity metrics",
    inputSchema: z.object({
      projectId: z.string(),
      scenarioId: z.string(),
    }),
  },
  {
    name: "calculateAccessibility",
    description: "Run analysis and return accessibility-oriented metrics",
    inputSchema: z.object({
      projectId: z.string(),
      scenarioId: z.string(),
    }),
  },
  {
    name: "estimateCapacity",
    description: "Run analysis and return capacity aggregates",
    inputSchema: z.object({
      projectId: z.string(),
      scenarioId: z.string(),
    }),
  },
  {
    name: "evaluateConstraints",
    description: "Return current constraints and whether results are stale",
    inputSchema: z.object({
      projectId: z.string(),
      scenarioId: z.string(),
    }),
  },
  {
    name: "rankCandidates",
    description: "Run analysis and return ranked candidates",
    inputSchema: z.object({
      projectId: z.string(),
      scenarioId: z.string(),
    }),
  },
  {
    name: "createScenario",
    description: "Create or duplicate a scenario",
    inputSchema: z.object({
      projectId: z.string(),
      name: z.string(),
      fromScenarioId: z.string().optional(),
    }),
  },
  {
    name: "updateScenario",
    description: "Rename scenario or set as active",
    inputSchema: z.object({
      projectId: z.string(),
      scenarioId: z.string(),
      name: z.string().optional(),
      activate: z.boolean().optional(),
    }),
  },
  {
    name: "compareScenarios",
    description: "Compare scenarios with consistent metrics",
    inputSchema: z.object({
      projectId: z.string(),
      scenarioIds: z.array(z.string()).min(2),
    }),
  },
  {
    name: "saveScenario",
    description: "Persist a scenario snapshot",
    inputSchema: z.object({
      projectId: z.string(),
      scenarioId: z.string(),
    }),
  },
  {
    name: "restoreScenario",
    description: "Activate a previously saved scenario",
    inputSchema: z.object({
      projectId: z.string(),
      scenarioId: z.string(),
    }),
  },
  {
    name: "getHumanDecisions",
    description: "List human decisions for a project",
    inputSchema: z.object({ projectId: z.string() }),
  },
  {
    name: "requestHumanDecision",
    description: "Create an explicit confirmation gate",
    inputSchema: z.object({
      projectId: z.string(),
      scenarioId: z.string(),
      title: z.string(),
      description: z.string(),
      impact: z.record(z.union([z.string(), z.number()])),
      proposedAction: z.record(z.any()),
    }),
  },
  {
    name: "recordDecision",
    description: "Record an explicit human planning decision",
    inputSchema: z.object({
      projectId: z.string(),
      scenarioId: z.string(),
      type: z.enum([
        "approve_scenario",
        "reject_scenario",
        "request_changes",
        "reject_candidate",
        "prefer_candidate",
        "prefer_scenario",
        "confirm_change",
        "reject_change",
      ]),
      subjectId: z.string().optional(),
      reason: z.string().optional(),
    }),
  },
  {
    name: "generatePlanningSummary",
    description: "Generate a short planning summary from latest results",
    inputSchema: z.object({
      projectId: z.string(),
      scenarioId: z.string(),
    }),
  },
  {
    name: "generateScenarioReport",
    description: "Generate a professional planning report",
    inputSchema: z.object({
      projectId: z.string(),
      scenarioIds: z.array(z.string()).min(1),
      title: z.string().optional(),
    }),
  },
  {
    name: "setDatasetEnabled",
    description: "Enable or disable a dataset globally",
    inputSchema: z.object({
      datasetId: z.string(),
      enabled: z.boolean(),
    }),
  },
] as const;

export type ToolName = (typeof toolDefinitions)[number]["name"];

const FORBIDDEN = new Set([
  "executeSQL",
  "executeJavascript",
  "executeCode",
  "clickButton",
  "clickAtCoordinates",
  "findElement",
  "querySelector",
  "eval",
]);

export function listTools() {
  return toolDefinitions.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: zodToJsonSchema(t.inputSchema),
  }));
}

function zodToJsonSchema(schema: z.ZodTypeAny): unknown {
  // Lightweight descriptor for discoverability
  return { type: "object", description: "See tool definition", zod: schema.description };
}

export async function invokeTool(
  name: string,
  rawArgs: unknown
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  if (FORBIDDEN.has(name) || /sql|eval|exec|dom|click|selector/i.test(name)) {
    return {
      ok: false,
      error: `Tool "${name}" is not permitted. Use semantic planning tools only.`,
    };
  }

  const def = toolDefinitions.find((t) => t.name === name);
  if (!def) return { ok: false, error: `Unknown tool: ${name}` };

  const parsed = def.inputSchema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }

  try {
    const args = parsed.data as Record<string, unknown>;
    switch (name as ToolName) {
      case "listProjects":
        return { ok: true, result: await services.listProjects() };
      case "getWorkspaceState":
        return { ok: true, result: await services.getWorkspace(args.projectId as string) };
      case "createProject":
        return {
          ok: true,
          result: await services.createProject(args as {
            name: string;
            objectiveText: string;
            geographyLabel?: string;
            mode?: "explore" | "planning";
          }),
        };
      case "updatePlanningObjective":
        return {
          ok: true,
          result: await services.updateObjective(
            args.projectId as string,
            args.objectiveText as string
          ),
        };
      case "getMapState": {
        const ws = await services.getWorkspace(args.projectId as string);
        return { ok: true, result: ws?.project.mapState ?? null };
      }
      case "setMapViewport":
        return {
          ok: true,
          result: await services.updateMapState(args.projectId as string, {
            viewport: {
              center: args.center as [number, number],
              zoom: args.zoom as number,
            },
          }),
        };
      case "toggleLayer": {
        const ws = await services.getWorkspace(args.projectId as string);
        if (!ws) return { ok: false, error: "Project not found" };
        const layers = ws.project.mapState.layers.map((l) =>
          l.datasetId === args.datasetId ? { ...l, visible: args.visible as boolean } : l
        );
        return {
          ok: true,
          result: await services.updateMapState(args.projectId as string, { layers }),
        };
      }
      case "selectFeatures":
        return {
          ok: true,
          result: await services.selectCandidate(
            args.projectId as string,
            args.candidateId as string | undefined,
            args.featureIds as string[]
          ),
        };
      case "highlightFeatures":
        return {
          ok: true,
          result: await services.updateMapState(args.projectId as string, {
            highlightFeatureIds: args.featureIds as string[],
          }),
        };
      case "createGeographicSelection":
        return {
          ok: true,
          result: await services.addGeographicSelection(
            args.projectId as string,
            args.scenarioId as string,
            {
              type: args.type as "exclusion" | "inclusion" | "focus",
              label: args.label as string,
              geometry: args.geometry as GeoJSON.Polygon,
              createdBy: (args.createdBy as "human" | "agent") ?? "agent",
            }
          ),
        };
      case "listAvailableLayers":
        return { ok: true, result: await services.listDatasets() };
      case "queryLayer":
        return { ok: true, result: await services.getFeatures(args.datasetId as string) };
      case "inspectFeature": {
        const fc = await services.getFeatures(args.datasetId as string);
        const feature = fc?.features.find(
          (f) =>
            String(f.id) === args.featureId ||
            String(f.properties?.id) === args.featureId
        );
        return { ok: true, result: feature ?? null };
      }
      case "updatePlanningCriteria": {
        const projectId = args.projectId as string;
        const scenarioId = args.scenarioId as string;
        if (args.constraints) {
          await services.updateConstraints(
            projectId,
            scenarioId,
            args.constraints as Parameters<typeof services.updateConstraints>[2]
          );
        }
        if (args.weights) {
          const weights = normalizeWeights(
            (args.weights as Array<{ id?: string; key: string; label: string; weight: number }>).map(
              (w) => ({
                id: w.id ?? w.key,
                key: w.key,
                label: w.label,
                weight: w.weight,
              })
            )
          );
          await services.updateWeights(projectId, scenarioId, weights);
        }
        if (args.transitThresholdMeters != null) {
          const ws = await services.getWorkspace(projectId);
          const sc = ws?.scenarios.find((s) => s.id === scenarioId);
          if (sc) {
            const constraints = sc.constraints.map((c) =>
              c.operator === "within_distance"
                ? {
                    ...c,
                    value: args.transitThresholdMeters as number,
                    label: `Within ${args.transitThresholdMeters}m of transit`,
                  }
                : c
            );
            await services.updateConstraints(projectId, scenarioId, constraints);
          }
        }
        return { ok: true, result: await services.getWorkspace(projectId) };
      }
      case "runSpatialFilter":
      case "calculateProximity":
      case "calculateAccessibility":
      case "estimateCapacity":
      case "rankCandidates":
        return {
          ok: true,
          result: await services.runAnalysis(
            args.projectId as string,
            args.scenarioId as string
          ),
        };
      case "evaluateConstraints": {
        const ws = await services.getWorkspace(args.projectId as string);
        const sc = ws?.scenarios.find((s) => s.id === args.scenarioId);
        const result = ws?.analysisResults.find((r) => r.id === sc?.latestResultId);
        return {
          ok: true,
          result: {
            constraints: sc?.constraints,
            stale: result?.stale ?? false,
            staleReason: result?.staleReason,
          },
        };
      }
      case "createScenario":
        return {
          ok: true,
          result: await services.createScenario(
            args.projectId as string,
            args.name as string,
            args.fromScenarioId as string | undefined
          ),
        };
      case "updateScenario": {
        if (args.activate) {
          await services.setActiveScenario(args.projectId as string, args.scenarioId as string);
        }
        if (args.name) {
          const store = await getStore();
          const sc = store.scenarios.find((s) => s.id === args.scenarioId);
          if (sc) sc.name = args.name as string;
        }
        return { ok: true, result: await services.getWorkspace(args.projectId as string) };
      }
      case "compareScenarios":
        return {
          ok: true,
          result: await services.compareScenarios(
            args.projectId as string,
            args.scenarioIds as string[]
          ),
        };
      case "saveScenario":
        return {
          ok: true,
          result: await services.saveScenario(
            args.projectId as string,
            args.scenarioId as string
          ),
        };
      case "restoreScenario":
        return {
          ok: true,
          result: await services.setActiveScenario(
            args.projectId as string,
            args.scenarioId as string
          ),
        };
      case "getHumanDecisions": {
        const ws = await services.getWorkspace(args.projectId as string);
        return { ok: true, result: ws?.decisions ?? [] };
      }
      case "requestHumanDecision":
        return {
          ok: true,
          result: await services.createConfirmation({
            projectId: args.projectId as string,
            scenarioId: args.scenarioId as string,
            title: args.title as string,
            description: args.description as string,
            impact: args.impact as Record<string, string | number>,
            proposedAction: args.proposedAction as Record<string, unknown>,
          }),
        };
      case "recordDecision":
        return {
          ok: true,
          result: await services.recordDecision({
            projectId: args.projectId as string,
            scenarioId: args.scenarioId as string,
            type: args.type as Parameters<typeof services.recordDecision>[0]["type"],
            subjectId: args.subjectId as string | undefined,
            reason: args.reason as string | undefined,
          }),
        };
      case "generatePlanningSummary": {
        const ws = await services.getWorkspace(args.projectId as string);
        const sc = ws?.scenarios.find((s) => s.id === args.scenarioId);
        const result = ws?.analysisResults.find((r) => r.id === sc?.latestResultId);
        return {
          ok: true,
          result: {
            summary: result?.summary ?? "No results yet",
            recommendation: result?.candidates.find((c) => c.rank === 1) ?? null,
            limitations: result?.limitations ?? [],
            decisionStatus: sc?.decisionStatus,
          },
        };
      }
      case "generateScenarioReport":
        return {
          ok: true,
          result: await services.generateReport(
            args.projectId as string,
            args.scenarioIds as string[],
            args.title as string | undefined
          ),
        };
      case "setDatasetEnabled":
        await services.setDatasetEnabled(args.datasetId as string, args.enabled as boolean);
        return { ok: true, result: await services.listDatasets() };
      default:
        return { ok: false, error: `Unhandled tool: ${name}` };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
