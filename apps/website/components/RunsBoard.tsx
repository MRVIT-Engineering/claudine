"use client";
// Three Agentic runs working side by side: each ticks through its plan, runs the
// checks, then waits for review. A timer drives it; with reduced motion all are done.
import { useEffect, useState } from "react";
import { AccountBadge } from "./Accounts";

const RUNS = [
  {
    title: "Fix the login race",
    branch: "claudine/fix-login-race",
    plan: [
      "Reproduce with a test",
      "Lock the session refresh",
      "Update the docs",
    ],
    speed: 1,
    files: 3,
  },
  {
    title: "Add CSV export",
    branch: "claudine/add-csv-export",
    plan: ["Add the export command", "Stream rows to the file", "Write tests"],
    speed: 0.7,
    files: 5,
  },
  {
    title: "Bump dependencies",
    branch: "claudine/bump-deps",
    plan: ["Update Cargo.lock", "Fix two deprecations", "Run the checks"],
    speed: 1.35,
    files: 2,
  },
];

/** Ticks per run: one per plan step, two for checks, then it stays ready. */
const DONE_AT = 3 + 2;
const LOOP = 16;

export function RunsBoard() {
  const [tick, setTick] = useState(LOOP);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setTick(0);
    const timer = setInterval(() => setTick((t) => (t + 1) % (LOOP + 1)), 700);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="runs" aria-hidden="true">
      {RUNS.map((run, index) => {
        const progress = Math.min(Math.floor(tick * run.speed), DONE_AT);
        const stepsDone = Math.min(progress, run.plan.length);
        const status =
          progress >= DONE_AT
            ? "ready"
            : progress >= run.plan.length
              ? "checks"
              : "working";
        return (
          <div key={run.branch} className={`run is-${status}`}>
            <div className="run-head">
              <span className="run-dot" />
              <strong>{run.title}</strong>
              <AccountBadge index={index} size={18} />
            </div>
            <code className="run-branch">{run.branch}</code>
            <ul className="run-plan">
              {run.plan.map((step, i) => (
                <li
                  key={step}
                  className={
                    i < stepsDone ? "is-done" : i === stepsDone ? "is-now" : ""
                  }
                >
                  <span className="run-box" />
                  {step}
                </li>
              ))}
            </ul>
            <div className="run-bar">
              <span style={{ width: `${(progress / DONE_AT) * 100}%` }} />
            </div>
            <div className="run-foot">
              <span className="run-status">
                {status === "ready"
                  ? "Ready for review"
                  : status === "checks"
                    ? "Running checks…"
                    : "Working in auto mode…"}
              </span>
              {status === "ready" && (
                <span className="run-files pop">{run.files} files changed</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
