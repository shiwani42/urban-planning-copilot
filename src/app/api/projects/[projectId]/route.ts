import { NextRequest, NextResponse } from "next/server";
import * as services from "@/lib/domain/services";

type Ctx = { params: Promise<{ projectId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { projectId } = await ctx.params;
  const ws = await services.getWorkspace(projectId);
  if (!ws) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(ws);
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { projectId } = await ctx.params;
  try {
    await services.deleteProject(projectId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { projectId } = await ctx.params;
  const body = await req.json();
  const action = body.action as string;

  try {
    switch (action) {
      case "record_open":
        await services.recordProjectOpen(projectId);
        return NextResponse.json({ ok: true });
      case "rename_project":
        return NextResponse.json({
          project: await services.renameProject(projectId, body.name),
        });
      case "update_objective":
        return NextResponse.json(
          await services.updateObjective(projectId, body.objectiveText)
        );
      case "update_constraints":
        return NextResponse.json(
          await services.updateConstraints(projectId, body.scenarioId, body.constraints)
        );
      case "update_weights":
        return NextResponse.json(
          await services.updateWeights(projectId, body.scenarioId, body.weights)
        );
      case "update_assumptions":
        return NextResponse.json(
          await services.updateAssumptions(projectId, body.scenarioId, body.assumptions)
        );
      case "run_analysis":
        return NextResponse.json(
          await services.runAnalysis(projectId, body.scenarioId)
        );
      case "create_scenario":
        return NextResponse.json(
          await services.createScenario(projectId, body.name, body.fromScenarioId)
        );
      case "save_scenario":
        return NextResponse.json(
          await services.saveScenario(projectId, body.scenarioId)
        );
      case "activate_scenario":
        return NextResponse.json(
          await services.setActiveScenario(projectId, body.scenarioId)
        );
      case "select_candidate":
        return NextResponse.json(
          await services.selectCandidate(
            projectId,
            body.candidateId,
            body.featureIds,
            body.scenarioId
          )
        );
      case "update_map":
        return NextResponse.json(await services.updateMapState(projectId, body.mapState));
      case "add_geo_selection":
        return NextResponse.json(
          await services.addGeographicSelection(projectId, body.scenarioId, body.selection)
        );
      case "remove_geo_selection":
        return NextResponse.json(
          await services.removeGeographicSelection(
            projectId,
            body.scenarioId,
            body.selectionId
          )
        );
      case "update_geo_selection":
        return NextResponse.json(
          await services.updateGeographicSelection(
            projectId,
            body.scenarioId,
            body.selectionId,
            body.patch ?? {}
          )
        );
      case "exclude_features":
        return NextResponse.json(
          await services.excludeFeatures(
            projectId,
            body.scenarioId,
            body.featureIds,
            body.label
          )
        );
      case "record_decision":
        return NextResponse.json(
          await services.recordDecision({
            projectId,
            scenarioId: body.scenarioId,
            type: body.type,
            subjectId: body.subjectId,
            reason: body.reason,
          })
        );
      case "resolve_confirmation":
        return NextResponse.json(
          await services.resolveConfirmation(projectId, body.confirmationId, body.status)
        );
      case "stage_proposal":
        return NextResponse.json(
          await services.stageProposal({
            projectId,
            scenarioId: body.scenarioId,
            title: body.title,
            description: body.description,
            action: body.action,
            payload: body.payload,
            createdBy: body.createdBy ?? "human",
          })
        );
      case "approve_proposal":
        return NextResponse.json(
          await services.approveProposal(projectId, body.proposalId)
        );
      case "reject_proposal":
        return NextResponse.json(
          await services.rejectProposal(projectId, body.proposalId, body.reason)
        );
      case "generate_report":
        return NextResponse.json(
          await services.generateReport(projectId, body.scenarioIds, body.title)
        );
      case "compare_scenarios":
        return NextResponse.json(
          await services.compareScenarios(projectId, body.scenarioIds)
        );
      case "rename_scenario":
        return NextResponse.json(
          await services.renameScenario(
            projectId,
            body.scenarioId,
            body.name,
            body.description
          )
        );
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
