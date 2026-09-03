import {
  CLIENT_STUDY_CONTINUE_NAME,
  INFILL_STUDY_CONTINUE_NAME,
} from "@/lib/planner-copy";
import { projectRecencyIso } from "@/lib/format";

export type ContinueCardProject = {
  id: string;
  name: string;
  updatedAt: string;
  lastOpenedAt?: string;
  geographyLabel?: string;
};

function isClientDemoStudy(name: string): boolean {
  return /client demo/i.test(name);
}

function isInfill2000Study(name: string): boolean {
  return /infill/i.test(name) && /2,?000/.test(name);
}

function isMissionSomaHousingStudy(project: ContinueCardProject): boolean {
  const blob = `${project.name} ${project.geographyLabel ?? ""}`.toLowerCase();
  return (
    isClientDemoStudy(project.name) ||
    isInfill2000Study(project.name) ||
    (/mission/i.test(blob) && /soma/i.test(blob) && /hous/i.test(blob))
  );
}

/** One continue card for the client Mission/SoMa study; duplicates stay in All projects. */
export function pickContinueProjects<T extends ContinueCardProject>(
  projects: T[],
  limit = 1
): T[] {
  if (projects.length === 0) return [];
  const byRecency = [...projects].sort((a, b) =>
    projectRecencyIso(b).localeCompare(projectRecencyIso(a))
  );

  const clientDemo = byRecency.find((p) => isClientDemoStudy(p.name));
  if (clientDemo) {
    const rest = byRecency.filter(
      (p) => p.id !== clientDemo.id && !isMissionSomaHousingStudy(p)
    );
    return [clientDemo, ...rest].slice(0, limit);
  }

  const infill = byRecency.find((p) => isInfill2000Study(p.name));
  if (infill) {
    const rest = byRecency.filter(
      (p) => p.id !== infill.id && !isMissionSomaHousingStudy(p)
    );
    return [infill, ...rest].slice(0, limit);
  }

  return byRecency.slice(0, limit);
}

export const CANONICAL_CONTINUE_TITLES = [
  CLIENT_STUDY_CONTINUE_NAME,
  INFILL_STUDY_CONTINUE_NAME,
] as const;
