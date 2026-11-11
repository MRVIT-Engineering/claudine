"use client";
// A looping, scripted picture of the app: you ask, Claude asks to edit, you allow,
// the edit lands. Plain timers and CSS; with reduced motion it shows the end state.
import { useEffect, useState } from "react";
import { Mascot } from "./Mascot";

const ASK = "Add a --verbose flag to the CLI";

/** The steps, each with how long it stays on screen. */
const STEPS = [
  { name: "idle", ms: 700 },
  { name: "typing", ms: ASK.length * 38 + 300 },
  { name: "sent", ms: 900 },
  { name: "thinking", ms: 1300 },
  { name: "permission", ms: 1500 },
  { name: "hover", ms: 700 },
  { name: "allowed", ms: 900 },
  { name: "applied", ms: 3200 },
] as const;

type Step = (typeof STEPS)[number]["name"];

const CODE = [
  { n: 1, t: "use clap::Parser;" },
  { n: 2, t: "" },
  { n: 3, t: "#[derive(Parser)]" },
  { n: 4, t: "struct Args {" },
  { n: 5, t: "    /// The file to read" },
  { n: 6, t: "    path: String," },
];
const ADDED = [
  "    /// Print every step",
  "    #[arg(long)]",
  "    verbose: bool,",
];

function at(step: Step, from: Step) {
  const names = STEPS.map((s) => s.name) as Step[];
  return names.indexOf(step) >= names.indexOf(from);
}

export function Demo() {
  const [step, setStep] = useState<Step>("applied");
  const [typed, setTyped] = useState(ASK.length);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let index = 0;
    let timer: ReturnType<typeof setTimeout>;
    let typing: ReturnType<typeof setInterval> | undefined;
    const run = () => {
      const current = STEPS[index];
      if (!current) return;
      setStep(current.name);
      clearInterval(typing);
      if (current.name === "idle") setTyped(0);
      if (current.name === "typing") {
        let n = 0;
        typing = setInterval(() => {
          n += 1;
          setTyped(n);
          if (n >= ASK.length) clearInterval(typing);
        }, 38);
      }
      timer = setTimeout(() => {
        index = (index + 1) % STEPS.length;
        run();
      }, current.ms);
    };
    run();
    return () => {
      clearTimeout(timer);
      clearInterval(typing);
    };
  }, []);

  const sent = at(step, "sent");
  const applied = at(step, "applied");
  const asking =
    step === "permission" || step === "hover" || step === "allowed";

  return (
    <div className="window" aria-hidden="true">
      <div className="window-bar">
        <span className="light" />
        <span className="light" />
        <span className="light" />
        <span className="window-title">claudine — my-cli</span>
      </div>
      <div className="window-body">
        <aside className="w-tree">
          <div className="w-tree-head">MY-CLI</div>
          <div className="w-row">▾ src</div>
          <div className="w-row w-in is-active">main.rs</div>
          <div className="w-row w-in">lib.rs</div>
          <div className="w-row">Cargo.toml</div>
          <div className="w-row">README.md</div>
        </aside>
        <section className="w-code">
          <div className="w-tabs">
            <span className="w-tab is-active">main.rs</span>
            <span className="w-tab">
              <Mascot size={11} /> Claude
            </span>
          </div>
          <pre>
            {CODE.map((line) => (
              <div key={line.n} className="ln">
                <span className="gutter">{line.n}</span>
                <Code text={line.t} />
              </div>
            ))}
            {ADDED.map((t, i) => (
              <div
                key={t}
                className={`ln is-added${applied ? " is-in" : ""}`}
                style={{ transitionDelay: `${i * 90}ms` }}
              >
                <span className="gutter">{7 + i}</span>
                <Code text={t} />
              </div>
            ))}
            <div className="ln">
              <span className="gutter">{applied ? 10 : 7}</span>
              <Code text="}" />
            </div>
          </pre>
        </section>
        <section className="w-chat">
          <div className="w-chat-scroll">
            {sent && <div className="bubble user pop">{ASK}</div>}
            {step === "thinking" && (
              <div className="thinking pop">
                <span />
                <span />
                <span />
              </div>
            )}
            {at(step, "permission") && (
              <div className="pop claude-line">
                I'll add the flag to <code>Args</code> in <code>main.rs</code>.
              </div>
            )}
            {asking && (
              <div className="perm pop">
                <strong>Claude wants to use Edit</strong>
                <code className="perm-path">src/main.rs</code>
                <div className="perm-diff">
                  {ADDED.map((t) => (
                    <div key={t}>+ {t.trim()}</div>
                  ))}
                </div>
                <div className="perm-actions">
                  <span className="w-btn">Deny</span>
                  <span
                    className={`w-btn accent${step === "hover" ? " is-hover" : ""}${
                      step === "allowed" ? " is-pressed" : ""
                    }`}
                  >
                    Allow
                  </span>
                </div>
                <span
                  className={`cursor${step === "hover" || step === "allowed" ? " is-on" : ""}`}
                />
              </div>
            )}
            {applied && (
              <div className="pop done-line">
                <span className="dot-ok" /> Edited src/main.rs, after you
                allowed it.
              </div>
            )}
          </div>
          <div className="w-input">
            <span>
              {sent ? "" : ASK.slice(0, typed)}
              {!sent && <span className="caret" />}
              {sent && <span className="placeholder">Ask Claude…</span>}
            </span>
            <span className="w-send" />
          </div>
        </section>
      </div>
    </div>
  );
}

/** Just enough highlighting for the sample. */
function Code(props: { text: string }) {
  const t = props.text;
  if (t.trim().startsWith("///"))
    return <span className="tk-comment">{t}</span>;
  if (t.trim().startsWith("#[")) return <span className="tk-attr">{t}</span>;
  const parts = t.split(/(\buse\b|\bstruct\b|\bString\b|\bbool\b|\bParser\b)/);
  return (
    <span>
      {parts.map((p, i) =>
        ["use", "struct"].includes(p) ? (
          <span key={i} className="tk-keyword">
            {p}
          </span>
        ) : ["String", "bool", "Parser"].includes(p) ? (
          <span key={i} className="tk-type">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </span>
  );
}
