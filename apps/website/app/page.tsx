import type { CSSProperties } from "react";
import { Accounts } from "../components/Accounts";
import { Demo } from "../components/Demo";
import { Mascot } from "../components/Mascot";
import { Reveal, Spotlight } from "../components/Motion";
import { RunsBoard } from "../components/RunsBoard";
import { SecurityDemo } from "../components/SecurityDemo";

const REPO = "https://github.com/MRVIT-Engineering/claudine";

/** GitHub's mark, inline, so the page loads nothing from elsewhere. */
function GitHubMark() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

const STEPS = [
  { title: "Hand off", text: "Describe the task, pick an account." },
  { title: "Work in parallel", text: "Own session, own branch, own worktree." },
  { title: "Review once", text: "Approve, and the PR opens." },
];

const ACCOUNT_POINTS = [
  "Several accounts at once",
  "Runs never switch accounts",
  "Claudine never sees a token",
];

const SHIELDS = [
  "Path guard",
  "Approvals kept in Rust",
  "No network from the app",
  "No telemetry",
  "Your own claude",
];

const NEVER = [
  "Extension marketplace",
  "Plugins",
  "Theme downloads",
  "Remote code",
  "Telemetry",
];

const SPEED = [
  { title: "Rust core", text: "Files, git, processes, checks." },
  { title: "Native, not Electron", text: "Your system's webview." },
  { title: "No virtual DOM", text: "SolidJS updates only what changed." },
];

const EDITOR = [
  "CodeMirror 6 with VS Code shortcuts",
  "Splits and draggable tabs",
  "Git panel, inline blame, diffs",
  "Find in project, go to file",
  "Markdown preview",
];

export default function Home() {
  return (
    <>
      <div className="glow" aria-hidden="true" />
      <header className="nav">
        <a className="brand" href="#top">
          <Mascot size={22} />
          Claudine
        </a>
        <nav>
          <a href="#agentic">Agentic</a>
          <a href="#accounts">Accounts</a>
          <a href="#security">Security</a>
          <a href="#speed">Speed</a>
          <a className="nav-cta" href={REPO}>
            <GitHubMark /> GitHub
          </a>
        </nav>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-mascot">
            <Mascot size={120} assemble />
          </div>
          <h1 className="hero-title">
            <span className="line">
              <span>First and last editor</span>
            </span>
            <span className="line">
              <span className="accent-text">for Claude Code.</span>
            </span>
          </h1>
          <p className="hero-sub">
            Run Claude Code in parallel, on all your accounts. Review at the
            end.
          </p>
          <div className="hero-ctas">
            <a className="btn btn-primary" href={REPO}>
              <GitHubMark /> View on GitHub
            </a>
            <a className="btn" href="#agentic">
              See Agentic mode
            </a>
          </div>
        </section>

        <Reveal className="demo-wrap hero-demo">
          <Demo />
        </Reveal>

        <section id="agentic" className="section">
          <Reveal>
            <p className="eyebrow">Agentic mode</p>
            <h2>Run many. Review once.</h2>
            <p className="lede">Each task gets its own Claude Code session.</p>
          </Reveal>
          <Reveal className="board-wrap">
            <RunsBoard />
          </Reveal>
          <ol className="steps">
            {STEPS.map((step, i) => (
              <Reveal as="li" key={step.title} delay={i * 110}>
                <Spotlight className="card step">
                  <span className="step-n">{i + 1}</span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.text}</p>
                  </div>
                </Spotlight>
              </Reveal>
            ))}
          </ol>
          <Reveal className="branches">
            <svg
              viewBox="0 0 640 220"
              role="img"
              aria-label="Three runs branching off main and merging back as pull requests"
            >
              <path className="b-main" d="M20 110 H620" />
              <path
                pathLength={1}
                className="b-run b1"
                d="M80 110 C130 110 130 40 180 40 H440 C490 40 490 110 540 110"
              />
              <path
                pathLength={1}
                className="b-run b2"
                d="M140 110 C190 110 190 180 240 180 H400 C450 180 450 110 500 110"
              />
              <path
                pathLength={1}
                className="b-run b3"
                d="M220 110 C260 110 260 75 300 75 H360 C400 75 400 110 440 110"
              />
              <circle className="b-dot d1" cx="180" cy="40" r="5" />
              <circle className="b-dot d2" cx="240" cy="180" r="5" />
              <circle className="b-dot d3" cx="300" cy="75" r="5" />
              <text x="190" y="28">
                fix-login-race
              </text>
              <text x="250" y="204">
                add-csv-export
              </text>
              <text x="310" y="63">
                bump-deps
              </text>
              <text x="552" y="98" className="b-pr">
                reviewed → PRs
              </text>
            </svg>
          </Reveal>
        </section>

        <section id="accounts" className="section">
          <Reveal className="acct-section">
            <div>
              <p className="eyebrow">Multiple accounts</p>
              <h2>Every Claude account. One editor.</h2>
              <p className="lede">
                Sign in once each. Switch from the chat input.
              </p>
              <ul className="acct-points">
                {ACCOUNT_POINTS.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
            <Accounts />
          </Reveal>
        </section>

        <section id="security" className="section">
          <Reveal>
            <p className="eyebrow">Security</p>
            <h2>The UI can only ask. Rust decides.</h2>
          </Reveal>
          <Reveal className="flow">
            <div className="flow-node">
              <span className="flow-label">Webview</span>
              <span className="flow-sub">untrusted</span>
            </div>
            <div className="flow-wire">
              <span className="flow-packet">allow #42</span>
            </div>
            <div className="flow-node is-core">
              <span className="flow-label">Rust core</span>
              <span className="flow-sub">path guard · approvals</span>
            </div>
            <div className="flow-wire">
              <span className="flow-packet is-late">kept input</span>
            </div>
            <div className="flow-node">
              <span className="flow-label">claude</span>
              <span className="flow-sub">your install</span>
            </div>
          </Reveal>
          <Reveal>
            <SecurityDemo />
          </Reveal>
          <Reveal>
            <ul className="shields">
              {SHIELDS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Reveal>
        </section>

        <section className="section">
          <Reveal className="never">
            <div>
              <p className="eyebrow">No marketplace</p>
              <h2>Nothing to install. Nothing to trust.</h2>
              <p className="lede">What ships is all there is.</p>
            </div>
            <ul className="never-list">
              {NEVER.map((item, i) => (
                <li
                  key={item}
                  style={{ "--delay": `${300 + i * 140}ms` } as CSSProperties}
                >
                  {item}
                </li>
              ))}
            </ul>
          </Reveal>
        </section>

        <section id="speed" className="section">
          <Reveal>
            <p className="eyebrow">Speed</p>
            <h2>A Rust core. Not a browser in a box.</h2>
          </Reveal>
          <div className="grid">
            {SPEED.map((s, i) => (
              <Reveal key={s.title} delay={i * 90}>
                <Spotlight className="card speed">
                  <span className="trace" />
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </Spotlight>
              </Reveal>
            ))}
          </div>
          <Reveal>
            <p className="eyebrow editor-eyebrow">And a real editor</p>
          </Reveal>
          <Reveal>
            <ul className="editor-list">
              {EDITOR.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Reveal>
        </section>

        <section className="section cta">
          <Reveal>
            <Mascot size={56} />
            <h2>Bring your own Claude Code.</h2>
            <p className="lede">
              Uses the Claude Code you already have. macOS and Linux.
            </p>
            <a
              className="btn btn-primary cta-btn"
              href={`${REPO}#build-from-source`}
            >
              <GitHubMark /> Build it from source
            </a>
          </Reveal>
        </section>
      </main>

      <footer className="footer">
        <span>
          <Mascot size={16} /> Claudine
        </span>
        <span className="footer-links">
          <a href={REPO}>GitHub</a>
          <a href={`${REPO}/blob/main/SECURITY.md`}>Security</a>
          <a href={`${REPO}/blob/main/LICENSE`}>MIT license</a>
          <span className="muted">No analytics on this page, either.</span>
        </span>
      </footer>
    </>
  );
}
