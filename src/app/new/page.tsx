"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { assessObjectiveQuality } from "@/lib/domain/objective";
import { EXPLORE_CONVERT_KEY, type ExploreConvertDraft } from "@/lib/domain/explore";

const DRAFT_KEY = "upc-new-project-draft";

const EXAMPLES = [
  {
    title: "Housing growth",
    text: "Identify areas capable of accommodating 2,000 additional homes while maximizing transit access and avoiding flood-risk areas.",
  },
  {
    title: "Emergency shelters",
    text: "Identify three locations for emergency shelters that maximize population coverage, prioritize accessibility, and avoid flood-risk areas.",
  },
  {
    title: "Schools",
    text: "Identify neighborhoods where a new school would most improve accessibility while avoiding areas already adequately served.",
  },
  {
    title: "Transit gaps",
    text: "Find neighborhoods with the largest transit accessibility gaps and identify areas where a new transit stop could improve access.",
  },
];

export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [objectiveError, setObjectiveError] = useState<string | null>(null);
  const [submitStatus, setSubmitStatus] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const objectiveRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as { name?: string; objective?: string };
        if (draft.name) setName(draft.name);
        if (draft.objective) setObjective(draft.objective);
        return;
      }
      const exploreRaw = sessionStorage.getItem(EXPLORE_CONVERT_KEY);
      if (exploreRaw) {
        const explore = JSON.parse(exploreRaw) as ExploreConvertDraft;
        if (explore.suggestedName) setName(explore.suggestedName);
        if (explore.objective) {
          const findingsNote = explore.summary
            ? `\n\n--- Scratch findings (${explore.analysisType.replace(/_/g, " ")}, ${explore.totalCandidates} areas) ---\n${explore.summary}`
            : "";
          setObjective(explore.objective + findingsNote);
        }
      }
    } catch {
      /* ignore corrupt draft */
    }
  }, []);

  useEffect(() => {
    try {
      if (!name.trim() && !objective.trim()) {
        sessionStorage.removeItem(DRAFT_KEY);
        return;
      }
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ name, objective }));
    } catch {
      /* storage unavailable */
    }
  }, [name, objective]);

  const objectiveQuality = useMemo(() => assessObjectiveQuality(objective), [objective]);

  const preview = useMemo(() => {
    const lower = objective.toLowerCase();
    const datasets: string[] = ["Parcels"];
    const analyses: string[] = ["Candidate filtering", "Ranking"];
    if (/transit|station|bus|rail/.test(lower)) {
      datasets.push("Transit");
      analyses.push("Transit proximity");
    }
    if (/flood/.test(lower)) {
      datasets.push("Flood risk");
      analyses.push("Flood exclusion");
    }
    if (/home|housing|unit/.test(lower)) analyses.push("Capacity estimation");
    if (/shelter|population|school/.test(lower)) {
      datasets.push("Population");
      analyses.push("Coverage / accessibility");
    }
    if (/school/.test(lower)) datasets.push("Schools");
    return { datasets, analyses };
  }, [objective]);

  function handleBack() {
    if (name.trim() || objective.trim()) {
      const discard = window.confirm(
        "Discard this draft? Your entries are saved in this browser session until you leave."
      );
      if (!discard) return;
      sessionStorage.removeItem(DRAFT_KEY);
    }
    router.push("/");
  }

  async function create() {
    setNameError(null);
    setObjectiveError(null);
    setSubmitStatus(null);

    let hasError = false;
    if (!name.trim()) {
      setNameError("Project name is required.");
      nameRef.current?.focus();
      hasError = true;
    } else if (name.trim().length < 2) {
      setNameError("Project name must be at least 2 characters.");
      nameRef.current?.focus();
      hasError = true;
    }
    if (!objective.trim()) {
      setObjectiveError("Planning objective is required.");
      if (!hasError) objectiveRef.current?.focus();
      hasError = true;
    } else if (!objectiveQuality.interpretable) {
      setObjectiveError(
        objectiveQuality.warning ??
          "Planning objective is too vague to analyze. Add targets and constraints."
      );
      if (!hasError) objectiveRef.current?.focus();
      hasError = true;
    }
    if (hasError) return;

    setBusy(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          objectiveText: objective.trim(),
          geographyLabel: "North River study area (synthetic)",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create workspace");
      sessionStorage.removeItem(DRAFT_KEY);
      sessionStorage.removeItem(EXPLORE_CONVERT_KEY);
      setSubmitStatus({
        kind: "success",
        message: `Workspace "${name.trim()}" created — opening planner…`,
      });
      router.push(`/workspace/${data.project.id}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setSubmitStatus({ kind: "error", message });
      setObjectiveError(message);
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader active="projects" />

      <div className="border-b border-outline-variant px-section-padding py-3 flex items-center gap-3">
        <button
          type="button"
          onClick={handleBack}
          className="text-body-sm text-primary hover:underline"
        >
          ← Back to projects
        </button>
        <h1 className="text-headline-md text-on-surface">New planning workspace</h1>
      </div>

      <main className="flex-1 grid lg:grid-cols-2 gap-px bg-outline-variant">
        <section className="bg-surface p-8 overflow-y-auto">
          {submitStatus && (
            <div
              role={submitStatus.kind === "error" ? "alert" : "status"}
              className={`mb-6 px-4 py-3 rounded border text-body-sm ${
                submitStatus.kind === "error"
                  ? "border-error bg-error-container/30 text-error"
                  : "border-secondary bg-secondary-fixed/20 text-secondary"
              }`}
            >
              {submitStatus.message}
            </div>
          )}
          <div className="mb-6">
            <label
              htmlFor="project-name"
              className="font-mono text-data-label text-on-surface-variant uppercase block mb-2"
            >
              Project name
            </label>
            <input
              id="project-name"
              ref={nameRef}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError(null);
              }}
              placeholder="e.g. North River Housing Strategy"
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? "project-name-error" : undefined}
              className={`w-full border-b bg-transparent py-2 text-body-lg focus:outline-none ${
                nameError ? "border-error" : "border-outline focus:border-primary"
              }`}
            />
            {nameError && (
              <p id="project-name-error" role="alert" className="text-body-sm text-error mt-1">
                {nameError}
              </p>
            )}
          </div>

          <div className="mb-6">
            <label
              htmlFor="planning-objective"
              className="font-mono text-data-label text-on-surface-variant uppercase block mb-2"
            >
              Planning objective
            </label>
            <textarea
              id="planning-objective"
              ref={objectiveRef}
              value={objective}
              onChange={(e) => {
                setObjective(e.target.value);
                if (objectiveError) setObjectiveError(null);
              }}
              rows={5}
              placeholder="Describe the planning question in natural language…"
              aria-invalid={Boolean(objectiveError)}
              aria-describedby={
                objectiveError
                  ? "planning-objective-error"
                  : objectiveQuality.warning
                    ? "planning-objective-warning"
                    : undefined
              }
              className={`w-full border rounded bg-surface-container-lowest p-3 text-body-sm focus:outline-none mb-2 ${
                objectiveError
                  ? "border-error"
                  : !objectiveQuality.interpretable && objective.trim()
                    ? "border-secondary"
                    : "border-outline-variant focus:border-primary"
              }`}
            />
            {objectiveError && (
              <p id="planning-objective-error" role="alert" className="text-body-sm text-error">
                {objectiveError}
              </p>
            )}
            {!objectiveError && objective.trim() && objectiveQuality.warning && (
              <p
                id="planning-objective-warning"
                role="status"
                className="text-body-sm text-secondary"
              >
                {objectiveQuality.warning}
              </p>
            )}
          </div>

          <h2 className="font-mono text-data-label text-on-surface-variant uppercase mb-3">
            Example questions
          </h2>
          <div className="grid sm:grid-cols-2 gap-3 mb-8">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.title}
                type="button"
                onClick={() => {
                  setObjective(ex.text);
                  if (!name) setName(ex.title);
                  setObjectiveError(null);
                }}
                className="text-left border border-outline-variant p-3 hover:border-primary transition-colors"
              >
                <div className="text-body-sm font-medium mb-1">{ex.title}</div>
                <div className="text-caption text-on-surface-variant line-clamp-3">{ex.text}</div>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={create}
            disabled={busy}
            className="bg-primary text-on-primary px-5 py-2.5 rounded text-body-sm font-medium disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create workspace"}
          </button>
        </section>

        <section className="bg-surface-container-low p-8">
          <h2 className="text-headline-md text-on-surface mb-6">What I&apos;ll prepare</h2>
          <div className="space-y-5">
            <div>
              <div className="font-mono text-data-label uppercase text-on-surface mb-1">Objective</div>
              <p className="text-body-sm text-on-surface-variant">
                {objective || "Enter a planning question to preview the plan."}
              </p>
              {objective.trim() && !objectiveQuality.interpretable && (
                <p className="text-caption text-secondary mt-2">
                  Low confidence — revise before creating the workspace.
                </p>
              )}
            </div>
            <div>
              <div className="font-mono text-data-label uppercase text-on-surface mb-1">Geography</div>
              <p className="text-body-sm">North River study area (synthetic seed geography)</p>
            </div>
            <div>
              <div className="font-mono text-data-label uppercase text-on-surface mb-2">
                Potential datasets
              </div>
              <div className="flex flex-wrap gap-2">
                {preview.datasets.map((d) => (
                  <span
                    key={d}
                    className="px-2 py-1 bg-surface border border-outline-variant font-mono text-[11px]"
                  >
                    {d}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div className="font-mono text-data-label uppercase text-on-surface mb-2">
                Potential analyses
              </div>
              <ul className="space-y-2">
                {preview.analyses.map((a) => (
                  <li key={a} className="text-body-sm flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px] text-primary">
                      analytics
                    </span>
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
