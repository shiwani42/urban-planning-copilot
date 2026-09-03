import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isResidentialParcel, parcelZoningLabel } from "./zoning";

function parcel(props: Record<string, unknown>): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: props,
    geometry: { type: "Point", coordinates: [-122.41, 37.76] },
  };
}

describe("parcel zoning overlay", () => {
  it("treats SF residential and mixed-use codes as residential", () => {
    assert.equal(isResidentialParcel(parcel({ zoning_code: "RH-2" })), true);
    assert.equal(isResidentialParcel(parcel({ zoning: "NCT-3" })), true);
    assert.equal(isResidentialParcel(parcel({ zoning: "R3" })), true);
    assert.equal(isResidentialParcel(parcel({ zoning: "MX" })), true);
    assert.equal(isResidentialParcel(parcel({ land_use: "residential" })), true);
    assert.equal(
      isResidentialParcel(parcel({ zoning_district: "Residential-Mixed" })),
      true
    );
  });

  it("treats industrial and open-space codes as other zoning", () => {
    assert.equal(isResidentialParcel(parcel({ zoning_code: "PDR-1" })), false);
    assert.equal(isResidentialParcel(parcel({ zoning: "C1", land_use: "other" })), false);
    assert.equal(isResidentialParcel(parcel({ zoning: "OS" })), false);
  });

  it("labels parcels with zoning code and district", () => {
    assert.equal(
      parcelZoningLabel(parcel({ zoning_code: "RH-2", zoning_district: "Residential House" })),
      "RH-2 — Residential House"
    );
    assert.equal(parcelZoningLabel(parcel({ zoning: "C-3" })), "C-3");
  });
});
