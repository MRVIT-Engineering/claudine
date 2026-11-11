"use client";
// Two moments where Claudine stops Claude: a read outside the project that you deny,
// and a push from an Agentic run that needs a native confirmation. Timer-driven;
// with reduced motion both rest in their answered state.
import { useEffect, useState } from "react";

const STEPS = ["ask", "deny", "denied", "push", "confirm", "pushed"] as const;
type Step = (typeof STEPS)[number];
const MS: Record<Step, number> = {
  ask: 1600,
  deny: 600,
  denied: 1500,
  push: 1500,
  confirm: 700,
  pushed: 2200,
};

function after(step: Step, from: Step) {
  return STEPS.indexOf(step) >= STEPS.indexOf(from);
}

export function SecurityDemo() {
  const [step, setStep] = useState<Step>("pushed");
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let index = 0;
    let timer: ReturnType<typeof setTimeout>;
    const run = () => {
      const current = STEPS[index] ?? "ask";
      setStep(current);
      timer = setTimeout(() => {
        index = (index + 1) % STEPS.length;
        run();
      }, MS[current]);
    };
    run();
    return () => clearTimeout(timer);
  }, []);

  const denied = after(step, "denied");
  const pushing = after(step, "push");

  return (
    <div className="sec" aria-hidden="true">
      <div className={`sec-card perm${denied ? " is-denied" : ""}`}>
        <strong>Claude wants to use Read</strong>
        <code className="perm-path">~/.ssh/id_ed25519</code>
        <span className="sec-warn">Outside the open folder</span>
        <div className="perm-actions">
          {denied ? (
            <span className="sec-result is-bad pop">Denied</span>
          ) : (
            <>
              <span
                className={`w-btn${step === "deny" ? " is-pressed is-hover-deny" : ""}`}
              >
                Deny
              </span>
              <span className="w-btn accent">Allow</span>
            </>
          )}
        </div>
      </div>

      <div className={`sec-card sec-run${pushing ? " is-on" : ""}`}>
        <div className="sec-run-head">
          <span className="run-dot" />
          <strong>Fix the login race</strong>
          <span className="sec-auto">auto mode</span>
        </div>
        <code className="sec-cmd">git push origin claudine/fix-login-race</code>
        {pushing && step !== "pushed" && (
          <div className="sec-dialog pop">
            <span className="sec-dialog-icon" />
            <strong>Push this branch?</strong>
            <span>A native dialog, not the webview.</span>
            <div className="perm-actions">
              <span className="w-btn">Cancel</span>
              <span
                className={`w-btn accent${step === "confirm" ? " is-pressed" : ""}`}
              >
                Push
              </span>
            </div>
          </div>
        )}
        {step === "pushed" && (
          <span className="sec-result is-good pop">
            Pushed after you confirmed
          </span>
        )}
      </div>
    </div>
  );
}
