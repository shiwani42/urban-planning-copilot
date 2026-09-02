"use client";

import Link from "next/link";

type NavKey = "projects" | "explore" | "data";

export function AppHeader({
  active,
  showNewProject = true,
}: {
  active?: NavKey;
  showNewProject?: boolean;
}) {
  const linkClass = (key: NavKey) =>
    key === active
      ? "text-primary font-medium border-b-2 border-primary pb-0.5"
      : "text-on-surface-variant hover:text-primary";

  return (
    <header className="h-16 border-b border-outline-variant bg-surface-container-high px-section-padding flex items-center justify-between shrink-0">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:bg-surface focus:text-primary focus:px-3 focus:py-2 focus:rounded focus:border focus:border-primary"
      >
        Skip to main content
      </a>
      {showNewProject && (
        <a
          href="#new-project-link"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-14 focus:z-[100] focus:bg-surface focus:text-primary focus:px-3 focus:py-2 focus:rounded focus:border focus:border-primary"
        >
          Skip to new project
        </a>
      )}
      <div className="flex items-center gap-8 min-w-0">
        <Link
          href="/"
          className="font-display text-[22px] font-semibold text-primary tracking-tight shrink-0"
        >
          Urban Planning Copilot
        </Link>
        <nav className="flex gap-4 text-body-sm">
          {active === "projects" ? (
            <span className={linkClass("projects")}>Projects</span>
          ) : (
            <Link href="/" className={linkClass("projects")}>
              Projects
            </Link>
          )}
          <Link href="/explore" className={linkClass("explore")}>
            Explore
          </Link>
          <Link href="/data" className={linkClass("data")}>
            Data
          </Link>
        </nav>
      </div>
      {showNewProject && (
        <Link
          id="new-project-link"
          href="/new"
          className="bg-primary text-on-primary px-4 py-2 rounded text-body-sm font-medium hover:bg-on-primary-fixed-variant transition-colors shrink-0"
        >
          + New planning project
        </Link>
      )}
    </header>
  );
}
