import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { resetStore } from "./store";
import * as services from "./services";
import { projectNameTaken } from "./services";
import { formatRelativeTime, greetingForHour, plannerGreeting, projectRecencyIso } from "../format";

const HOUSING_OBJECTIVE =
  "Identify areas capable of accommodating 2,000 additional homes while maximizing transit access and avoiding flood-risk areas.";

describe("project list services", () => {
  beforeEach(async () => {
    process.env.DATA_DIR = `/tmp/upc-projects-test-${Date.now()}-${Math.random()}`;
    await resetStore();
  });

  afterEach(async () => {
    delete process.env.DATA_DIR;
  });

  it("lists projects sorted by updatedAt descending", async () => {
    const first = await services.createProject({
      name: "Alpha plan",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const second = await services.createProject({
      name: "Beta plan",
      objectiveText: HOUSING_OBJECTIVE,
    });
    await services.renameProject(second.project.id, "Beta renamed");

    const list = await services.listProjects();
    assert.equal(list.length, 2);
    assert.equal(list[0].id, second.project.id);
    assert.ok(list[0].updatedAt >= list[1].updatedAt);
    assert.equal(list[1].id, first.project.id);
  });

  it("rejects rename shorter than 2 characters", async () => {
    const ws = await services.createProject({
      name: "North River",
      objectiveText: HOUSING_OBJECTIVE,
    });
    await assert.rejects(
      () => services.renameProject(ws.project.id, "A"),
      /at least 2 characters/
    );
  });

  it("rejects rename to duplicate name", async () => {
    const a = await services.createProject({
      name: "North River",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const b = await services.createProject({
      name: "East Side",
      objectiveText: HOUSING_OBJECTIVE,
    });
    await assert.rejects(
      () => services.renameProject(b.project.id, "north river"),
      /already exists/
    );
    const unchanged = await services.getWorkspace(a.project.id);
    assert.equal(unchanged?.project.name, "North River");
  });

  it("warns on duplicate create but still creates", async () => {
    await services.createProject({
      name: "North River",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const second = await services.createProject({
      name: "North River",
      objectiveText: HOUSING_OBJECTIVE,
    });
    assert.equal(second.duplicateNameWarning, true);
    assert.equal((await services.listProjects()).length, 2);
  });

  it("records lastOpenedAt and deletes project with cascades", async () => {
    const ws = await services.createProject({
      name: "Transit Hub",
      objectiveText: HOUSING_OBJECTIVE,
    });
    await services.recordProjectOpen(ws.project.id);
    const listed = await services.listProjects();
    assert.ok(listed[0].lastOpenedAt);

    await services.runAnalysis(ws.project.id, ws.project.activeScenarioId!);
    await services.deleteProject(ws.project.id);

    assert.equal((await services.listProjects()).length, 0);
    assert.equal(await services.getWorkspace(ws.project.id), null);
  });

  it("detects duplicate names case-insensitively", async () => {
    const store = await resetStore();
    store.projects.push({
      id: "p1",
      name: "North River",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      geographyLabel: "Synthetic",
      mapState: {
        viewport: { center: [0, 0], zoom: 12 },
        layers: [],
        selectedFeatureIds: [],
        highlightFeatureIds: [],
        drawingMode: "none",
      },
      mode: "planning",
    });
    assert.equal(projectNameTaken(store, "north river"), true);
    assert.equal(projectNameTaken(store, "North River", "p1"), false);
  });
});

describe("format helpers for home", () => {
  it("maps local hours to greeting", () => {
    assert.equal(greetingForHour(8), "Good morning");
    assert.equal(greetingForHour(14), "Good afternoon");
    assert.equal(greetingForHour(20), "Good evening");
    assert.match(plannerGreeting(new Date("2026-09-02T09:00:00")), /^Good morning, planner$/);
  });

  it("formats relative recency", () => {
    const now = new Date("2026-09-02T12:00:00");
    assert.equal(formatRelativeTime("2026-09-02T11:50:00", now), "10 min ago");
    assert.equal(formatRelativeTime("2026-09-01T12:00:00", now), "Yesterday");
  });

  it("prefers lastOpenedAt for recency sort key", () => {
    assert.equal(
      projectRecencyIso({
        updatedAt: "2026-09-01T00:00:00.000Z",
        lastOpenedAt: "2026-09-02T00:00:00.000Z",
      }),
      "2026-09-02T00:00:00.000Z"
    );
  });
});
