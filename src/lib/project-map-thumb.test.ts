import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import path from "node:path";
import { MISSION_SOMA_MAP_THUMB, projectMapThumbSrc } from "./project-map-thumb";

test("project cards use a checked-in Mission/SoMa map image", () => {
  assert.equal(projectMapThumbSrc("Mission/SoMa, San Francisco"), MISSION_SOMA_MAP_THUMB);
  assert.equal(projectMapThumbSrc("Study area"), MISSION_SOMA_MAP_THUMB);
  assert.match(MISSION_SOMA_MAP_THUMB, /\.webp$/);
  const filePath = path.join(process.cwd(), "public", MISSION_SOMA_MAP_THUMB.replace(/^\//, ""));
  assert.equal(existsSync(filePath), true, `${filePath} should be checked in`);
});
