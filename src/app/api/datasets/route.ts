import { NextRequest, NextResponse } from "next/server";
import * as services from "@/lib/domain/services";
import { getStore } from "@/lib/domain/store";

export async function GET(req: NextRequest) {
  const datasetId = req.nextUrl.searchParams.get("id");
  if (datasetId) {
    const meta = (await services.listDatasets()).find((d) => d.id === datasetId);
    const features = await services.getFeatures(datasetId);
    return NextResponse.json({ meta, features });
  }
  return NextResponse.json({ datasets: await services.listDatasets() });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  if (body.action === "set_enabled") {
    await services.setDatasetEnabled(body.datasetId, body.enabled);
    return NextResponse.json({ datasets: await services.listDatasets() });
  }
  if (body.action === "mark_stale") {
    await services.markDatasetStale(body.datasetId, body.stale);
    return NextResponse.json({ datasets: await services.listDatasets() });
  }
  if (body.action === "patch_feature") {
    await services.patchFeatureProperties(body.datasetId, body.featureId, body.props);
    const store = await getStore();
    return NextResponse.json({
      feature: store.featuresByDataset[body.datasetId]?.features.find(
        (f) => String(f.id) === body.featureId || String(f.properties?.id) === body.featureId
      ),
    });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
