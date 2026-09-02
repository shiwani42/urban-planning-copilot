"use client";

import { useEffect, useState } from "react";
import { plannerGreeting } from "@/lib/format";

/** Client-only greeting so SSR does not pin the server timezone hour. */
export function PlannerGreeting({ className }: { className?: string }) {
  const [text, setText] = useState("Welcome, planner");

  useEffect(() => {
    setText(plannerGreeting());
  }, []);

  return <h2 className={className}>{text}</h2>;
}
