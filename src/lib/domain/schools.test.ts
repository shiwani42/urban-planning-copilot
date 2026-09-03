import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attachSanFranciscoSchools, loadSanFranciscoSchools } from "./sf-data";
import type { DatasetMeta } from "./types";

describe("San Francisco schools snapshot", () => {
  it("loads active Mission/SoMa school sites", async () => {
    const schools = await loadSanFranciscoSchools();
    assert.ok(schools, "schools.geojson.gz should be checked in");
    assert.equal(schools.dataset.synthetic, false);
    assert.equal(schools.dataset.kind, "schools");
    assert.match(schools.dataset.name, /Schools/);
    assert.ok(schools.features.features.length >= 10);
    assert.ok(
      schools.features.features.every((f) => f.geometry?.type === "Point")
    );
  });

  it("attaches schools onto an SF parcel catalog and leaves synthetic cities alone", async () => {
    const synthetic = {
      datasets: [
        {
          id: "ds-parcels",
          kind: "parcels",
          name: "Parcels",
          synthetic: true,
        } as DatasetMeta,
      ],
      featuresByDataset: {},
    };
    assert.equal(await attachSanFranciscoSchools(synthetic), false);
    assert.equal(synthetic.datasets.some((d) => d.kind === "schools"), false);

    const city = {
      datasets: [
        {
          id: "ds-parcels",
          kind: "parcels",
          name: "Active parcels (San Francisco)",
          synthetic: false,
        } as DatasetMeta,
      ],
      featuresByDataset: {},
    };
    assert.equal(await attachSanFranciscoSchools(city), true);
    const schools = city.datasets.find((d) => d.kind === "schools");
    assert.ok(schools);
    assert.equal(schools.synthetic, false);
    assert.ok(city.featuresByDataset[schools.id]?.features.length);
  });
});
