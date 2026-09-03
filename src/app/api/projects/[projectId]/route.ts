import { NextRequest } from "next/server";
import * as services from "@/lib/domain/services";
import type { Assumption, Constraint, CriterionWeight, GeographicSelection, MapState } from "@/lib/domain/types";
import { apiError, runApiHandler } from "@/lib/api-route";

const PATCH_ACTION_ALIASES: Record<string, string> = {
  runAnalysis: "run_analysis",
};

function normalizeProjectPatchAction(raw: string): string {
  const trimmed = raw?.trim();
  if (!trimmed) return "";
  return PATCH_ACTION_ALIASES[trimmed] ?? trimmed;
}

type Ctx = { params: Promise<{ projectId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { projectId } = await ctx.params;
  return runApiHandler(async () => {
    const ws = await services.getWorkspace(projectId);
    if (!ws) throw new Error("Project not found");
    return ws;
  });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { projectId } = await ctx.params;
  return runApiHandler(async () => {
    await services.deleteProject(projectId);
    return { ok: true };
  });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { projectId } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON body", 400);
  }

  const action = normalizeProjectPatchAction(body.action as string);
  if (!action) {
    return apiError("Missing action", 400);
  }

  return runApiHandler(async () => {
    switch (action) {
      case "record_open":
        await services.recordProjectOpen(projectId);
        return { ok: true };
      case "rename_project":
        return { project: await services.renameProject(projectId, body.name as string) };
      case "update_objective":
        return services.updateObjective(projectId, body.objectiveText as string);
      case "update_constraints":
        return services.updateConstraints(
          projectId,
          body.scenarioId as string,
          body.constraints as Constraint[]
        );
      case "update_weights":
        return services.updateWeights(
          projectId,
          body.scenarioId as string,
          body.weights as CriterionWeight[]
        );
      case "update_assumptions":
        return services.updateAssumptions(
          projectId,
          body.scenarioId as string,
          body.assumptions as Assumption[]
        );
      case "run_analysis":
        return services.runAnalysis(projectId, body.scenarioId as string);
      case "create_scenario":
        return services.createScenario(
          projectId,
          body.name as string,
          body.fromScenarioId as string | undefined
        );
      case "save_scenario":
        return services.saveScenario(projectId, body.scenarioId as string);
      case "activate_scenario":
        return services.setActiveScenario(projectId, body.scenarioId as string);
      case "select_candidate":
        return services.selectCandidate(
          projectId,
          body.candidateId as string,
          body.featureIds as string[] | undefined,
          body.scenarioId as string | undefined
        );
      case "update_map":
        return services.updateMapState(projectId, body.mapState as Partial<MapState>);
      case "add_geo_selection":
        return services.addGeographicSelection(
          projectId,
          body.scenarioId as string,
          body.selection as Omit<GeographicSelection, "id" | "createdAt">
        );
      case "remove_geo_selection":
        return services.removeGeographicSelection(
          projectId,
          body.scenarioId as string,
          body.selectionId as string
        );
      case "update_geo_selection":
        return services.updateGeographicSelection(
          projectId,
          body.scenarioId as string,
          body.selectionId as string,
          (body.patch ?? {}) as Parameters<typeof services.updateGeographicSelection>[3]
        );
      case "exclude_features":
        return services.excludeFeatures(
          projectId,
          body.scenarioId as string,
          body.featureIds as string[],
          body.label as string
        );
      case "record_decision":
        return services.recordDecision({
          projectId,
          scenarioId: body.scenarioId as string,
          type: body.type as Parameters<typeof services.recordDecision>[0]["type"],
          subjectId: body.subjectId as string | undefined,
          reason: body.reason as string | undefined,
        });
      case "add_to_shortlist":
        return services.addToShortlist(
          projectId,
          body.scenarioId as string,
          body.candidateId as string,
          { reason: body.reason as string | undefined, note: body.note as string | undefined }
        );
      case "remove_from_shortlist":
        return services.removeFromShortlist(
          projectId,
          body.scenarioId as string,
          body.candidateId as string
        );
      case "update_shortlist_note":
        return services.updateShortlistNote(
          projectId,
          body.scenarioId as string,
          body.candidateId as string,
          (body.note as string) ?? ""
        );
      case "resolve_confirmation":
        return services.resolveConfirmation(
          projectId,
          body.confirmationId as string,
          body.status as Parameters<typeof services.resolveConfirmation>[2]
        );
      case "stage_proposal":
        return services.stageProposal({
          projectId,
          scenarioId: body.scenarioId as string,
          title: body.title as string,
          description: body.description as string,
          action: body.action as string,
          payload: body.payload as Record<string, unknown>,
          createdBy: (body.createdBy as "human" | "agent") ?? "human",
        });
      case "approve_proposal":
        return services.approveProposal(projectId, body.proposalId as string);
      case "reject_proposal":
        return services.rejectProposal(
          projectId,
          body.proposalId as string,
          body.reason as string | undefined
        );
      case "generate_report":
        return services.generateReport(
          projectId,
          body.scenarioIds as string[],
          body.title as string | undefined
        );
      case "compare_scenarios":
        return services.compareScenarios(projectId, body.scenarioIds as string[]);
      case "rename_scenario":
        return services.renameScenario(
          projectId,
          body.scenarioId as string,
          body.name as string,
          body.description as string | undefined
        );
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  });
}
