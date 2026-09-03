import { basemapAttribution, cartoBasemapUrl } from "@/lib/basemap";
import { runApiHandler } from "@/lib/api-route";

/** Runtime tile template so a Render secret is used even if Next did not inline it at build. */
export async function GET() {
  return runApiHandler(async () => ({
    url: cartoBasemapUrl("voyager"),
    attribution: basemapAttribution(),
  }));
}
