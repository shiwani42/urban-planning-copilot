"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { assessObjectiveQuality } from "@/lib/domain/objective";
import { EXPLORE_CONVERT_KEY, type ExploreConvertDraft } from "@/lib/domain/explore";
import {
  NEW_PROJECT_EXAMPLES,
  buildNewProjectPreview,
  type NewProjectExample,
} from "@/lib/new-project-preview";

const DRAFT_KEY = "upc-new-project-draft";
const LOCAL_DRAFT_KEY = "upc-new-project-draft-local";

const DATASET_ICONS: Record<string, string> = {
  Parcels: "real_estate_agent",
  Zoning: "architecture",
  Transit: "directions_bus",
  "Flood risk": "flood",
  Population: "groups",
  Schools: "school",
};

export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [objectiveError, setObjectiveError] = useState<string | null>(null);
  const [duplicateNameWarning, setDuplicateNameWarning] = useState(false);
  const [existingNames, setExistingNames] = useState<string[]>([]);
  const [submitStatus, setSubmitStatus] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const objectiveRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      const localRaw = localStorage.getItem(LOCAL_DRAFT_KEY);
      if (localRaw) {
        const draft = JSON.parse(localRaw) as { name?: string; objective?: string; error?: string };
        if (draft.name) setName(draft.name);
        if (draft.objective) setObjective(draft.objective);
        if (draft.error) {
          setSubmitStatus({
            kind: "error",
            message: `Previous create failed: ${draft.error}. Draft restored — retry when storage is healthy.`,
          });
        }
        return;
      }
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
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => {
        setExistingNames(
          (d.projects ?? []).map((p: { name: string }) => p.name.trim().toLowerCase())
        );
      })
      .catch(() => {
        /* list optional for duplicate hint */
      });
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
  const preview = useMemo(() => buildNewProjectPreview(objective), [objective]);

  useEffect(() => {
    const trimmed = name.trim().toLowerCase();
    setDuplicateNameWarning(
      trimmed.length >= 2 && existingNames.some((n) => n === trimmed)
    );
  }, [name, existingNames]);

  function applyExample(ex: NewProjectExample) {
    setObjective(ex.text);
    if (!name.trim()) setName(ex.title);
    setHighlightId(ex.id);
    setObjectiveError(null);
    objectiveRef.current?.focus();
  }

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
          geographyLabel: "San Francisco — Mission & SoMa demo area",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message =
          typeof data.error === "string"
            ? data.error
            : "Failed to create workspace — server returned an error.";
        throw new Error(message);
      }
      const projectId = data?.project?.id as string | undefined;
      if (!projectId) {
        throw new Error(
          "Workspace was created but the server response did not include a project id. Retry from Projects or contact support."
        );
      }
      const verify = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
      if (!verify.ok) {
        throw new Error(
          `Workspace was not saved on the server (project ${projectId} not found). Retry when storage is healthy.`
        );
      }
      sessionStorage.removeItem(DRAFT_KEY);
      localStorage.removeItem(LOCAL_DRAFT_KEY);
      sessionStorage.removeItem(EXPLORE_CONVERT_KEY);
      setSubmitStatus({
        kind: "success",
        message: `Workspace "${name.trim()}" created — opening planner…`,
      });
      try {
        await router.push(`/workspace/${projectId}`);
      } catch {
        setSubmitStatus({
          kind: "error",
          message: `Workspace created but navigation failed. Open /workspace/${projectId} from Projects.`,
        });
        setBusy(false);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      try {
        localStorage.setItem(
          LOCAL_DRAFT_KEY,
          JSON.stringify({
            name: name.trim(),
            objective: objective.trim(),
            error: message,
            savedAt: new Date().toISOString(),
          })
        );
      } catch {
        /* storage unavailable */
      }
      setSubmitStatus({
        kind: "error",
        message: `${message} Your draft is saved in this browser — retry when workspace storage recovers.`,
      });
      setObjectiveError(message);
      setBusy(false);
    }
  }

  const showPopulated = preview.confidence !== "empty";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader active="projects" />

      <div className="border-b border-outline-variant px-section-padding py-3 flex items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={handleBack}
          className="text-body-sm text-primary hover:underline flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          Back to projects
        </button>
        <h1 className="text-headline-md text-on-surface flex-1 text-center">New planning workspace</h1>
        <div className="w-[120px]" aria-hidden />
      </div>

      <div className="flex-1 flex overflow-hidden min-h-0">
        <main className="flex-1 bg-surface-container-lowest overflow-y-auto flex flex-col">
          <div className="max-w-4xl mx-auto w-full px-8 lg:px-12 py-10 flex-1 flex flex-col">
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

            <h2 className="text-display text-on-surface mb-8">What are you trying to plan?</h2>

            <div className="mb-4">
              <label
                htmlFor="project-name"
                className="font-mono text-data-label text-on-surface-variant uppercase block mb-2 tracking-wider"
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
                placeholder="e.g. San Francisco Housing Strategy"
                aria-invalid={Boolean(nameError)}
                className={`w-full border-b bg-transparent py-2 text-body-lg focus:outline-none ${
                  nameError ? "border-error" : "border-outline focus:border-primary"
                }`}
              />
              {nameError && (
                <p role="alert" className="text-body-sm text-error mt-1">
                  {nameError}
                </p>
              )}
              {!nameError && duplicateNameWarning && (
                <p role="status" className="text-body-sm text-secondary mt-1">
                  A project with this name already exists. Consider a unique name to avoid confusion.
                </p>
              )}
            </div>

            <div className="relative w-full mb-2 group">
              <label
                htmlFor="planning-objective"
                className="font-mono text-data-label text-on-surface-variant block mb-2 uppercase tracking-wider"
              >
                Planning objective
              </label>
              <textarea
                id="planning-objective"
                ref={objectiveRef}
                value={objective}
                onChange={(e) => {
                  setObjective(e.target.value);
                  setHighlightId(null);
                  if (objectiveError) setObjectiveError(null);
                }}
                rows={4}
                placeholder="Example: Identify areas where we could accommodate 2,000 additional homes while improving transit access and avoiding flood-risk areas."
                aria-invalid={Boolean(objectiveError)}
                className={`w-full bg-surface border-b-2 focus:outline-none focus:ring-0 font-body-lg text-body-lg text-on-surface placeholder-on-surface-variant/50 resize-none pb-4 transition-colors bg-transparent ${
                  objectiveError
                    ? "border-error"
                    : !objectiveQuality.interpretable && objective.trim()
                      ? "border-secondary"
                      : "border-outline-variant focus:border-primary"
                }`}
              />
            </div>
            <p className="text-body-sm text-on-surface-variant mb-2 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[16px]">info</span>
              Start with a question. You can refine criteria with the Copilot after the workspace opens.
            </p>
            {objectiveError && (
              <p role="alert" className="text-body-sm text-error mb-2">
                {objectiveError}
              </p>
            )}
            {!objectiveError && objective.trim() && objectiveQuality.warning && (
              <p role="status" className="text-body-sm text-secondary mb-4">
                {objectiveQuality.warning}
              </p>
            )}

            <div className="mt-8">
              <h3 className="font-mono text-data-label text-on-surface-variant uppercase tracking-wider mb-4">
                Example questions
              </h3>
              <div className="grid sm:grid-cols-2 gap-4">
                {NEW_PROJECT_EXAMPLES.map((ex) => (
                  <button
                    key={ex.id}
                    type="button"
                    onClick={() => applyExample(ex)}
                    onMouseEnter={() => setHighlightId(ex.id)}
                    onMouseLeave={() => setHighlightId(null)}
                    className={`text-left p-4 border rounded bg-surface transition-all hover:border-primary ${
                      highlightId === ex.id ? "border-primary shadow-sm" : "border-outline-variant"
                    }`}
                  >
                    <h4 className="text-body-lg font-medium text-on-surface mb-1">{ex.title}</h4>
                    <p className="text-body-sm text-on-surface-variant line-clamp-2">{ex.text}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-auto border-t border-outline-variant bg-surface-bright/80 backdrop-blur px-8 lg:px-12 py-6 flex flex-wrap items-center justify-between gap-4 shrink-0">
            <div>
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <button
                  type="button"
                  onClick={create}
                  disabled={busy}
                  className="bg-primary text-on-primary px-6 py-2.5 rounded text-body-sm font-medium hover:bg-primary-container hover:text-on-primary-container disabled:opacity-50"
                >
                  {busy ? "Creating…" : "Create workspace"}
                </button>
              </div>
              <p className="text-caption text-outline flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px]">shield_person</span>
                The Copilot will propose an analysis plan before running consequential analyses. You
                remain in control.
              </p>
            </div>
          </div>
        </main>

        <aside className="w-full max-w-[400px] border-l border-outline-variant bg-surface-container-low flex flex-col shrink-0 hidden lg:flex">
          <div className="p-4 border-b border-outline-variant bg-[#F0EEEB] flex items-center justify-between shrink-0">
            <h2 className="text-headline-md text-on-surface">What I&apos;ll prepare</h2>
            <span className="material-symbols-outlined text-outline">analytics</span>
          </div>
          <div className="flex-1 p-6 overflow-y-auto space-y-8">
            {!showPopulated ? (
              <div className="text-center mt-12 opacity-60">
                <span className="material-symbols-outlined text-[48px] text-outline mb-4 block">
                  edit_document
                </span>
                <p className="text-body-sm text-on-surface-variant">
                  Start typing or pick an example to see how the Copilot will parse your objective.
                </p>
              </div>
            ) : (
              <>
                <section>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="material-symbols-outlined text-primary-container text-[16px]">
                      flag
                    </span>
                    <h3 className="font-mono text-data-label text-on-surface uppercase">Objective</h3>
                  </div>
                  <div
                    className={`p-3 bg-surface border border-outline-variant rounded text-body-sm text-on-surface ${
                      preview.parsing ? "border-primary-container/40" : ""
                    }`}
                  >
                    {preview.objectiveLine}
                  </div>
                  {preview.confidence === "low" && (
                    <p className="text-caption text-secondary mt-2">
                      Low confidence — add targets and constraints before creating.
                    </p>
                  )}
                </section>

                <section>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="material-symbols-outlined text-primary-container text-[16px]">
                      map
                    </span>
                    <h3 className="font-mono text-data-label text-on-surface uppercase">Geography</h3>
                  </div>
                  <span className="inline-block px-2 py-1 bg-surface-container-high border border-outline rounded font-mono text-data-label text-on-surface text-[11px]">
                    {preview.geography}
                  </span>
                </section>

                <section>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="material-symbols-outlined text-primary-container text-[16px]">
                      database
                    </span>
                    <h3 className="font-mono text-data-label text-on-surface uppercase">
                      Potential datasets
                    </h3>
                  </div>
                  <ul className="space-y-2">
                    {preview.datasets.map((d) => (
                      <li
                        key={d}
                        className={`flex items-center gap-3 p-2 bg-surface border border-outline-variant rounded transition-colors ${
                          highlightId &&
                          ((highlightId === "housing" && (d === "Parcels" || d === "Zoning")) ||
                            (highlightId === "transit" && d === "Transit") ||
                            (highlightId === "climate" && d === "Flood risk") ||
                            (highlightId === "schools" && d === "Schools"))
                            ? "border-primary bg-surface-container"
                            : ""
                        }`}
                      >
                        <span className="material-symbols-outlined text-outline text-[18px]">
                          {DATASET_ICONS[d] ?? "dataset"}
                        </span>
                        <span className="text-body-sm text-on-surface">{d}</span>
                      </li>
                    ))}
                  </ul>
                </section>

                <section>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="material-symbols-outlined text-primary-container text-[16px]">
                      model_training
                    </span>
                    <h3 className="font-mono text-data-label text-on-surface uppercase">
                      Potential analyses
                    </h3>
                  </div>
                  <div className="space-y-3 relative before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-px before:bg-primary-container">
                    {preview.analyses.map((step, i) => (
                      <div key={step.label} className="flex items-start gap-3 relative z-10 pl-6">
                        <div className="absolute left-[7px] top-[12px] w-2 h-2 rounded bg-primary-container ring-4 ring-surface-container-low" />
                        <div>
                          <h4 className="font-mono text-data-label text-on-surface mb-1">
                            {step.label}
                          </h4>
                          <p className="text-caption text-on-surface-variant">{step.detail}</p>
                          {i === 0 && highlightId === "housing" && (
                            <span className="sr-only">Highlighted for housing example</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
