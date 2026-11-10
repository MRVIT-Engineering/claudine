// What Claude is up to while it works: the tool it's running, or a rotating playful line.
import { createSignal, onCleanup } from "solid-js";
import type { ChatEntry } from "../state/claude";

const PHRASES = [
  "Thinking it through",
  "Reading between the lines",
  "Untangling the code",
  "Consulting the rubber duck",
  "Connecting the dots",
  "Polishing the details",
  "Following the call chain",
  "Weighing the options",
  "Tidying up loose ends",
  "Brewing a fix",
  "Asking the tests nicely",
  "Herding semicolons",
];

/** A short line for a tool that's still running, such as "Reading pool.rs". */
function toolLine(entry: Extract<ChatEntry, { kind: "tool" }>): string {
  const target = entry.summary.split("\n")[0]?.slice(0, 60) ?? "";
  switch (entry.name) {
    case "Read":
      return `Reading ${target}`;
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
      return `Editing ${target}`;
    case "Bash":
      return `Running ${target}`;
    case "Grep":
    case "Glob":
      return `Searching for ${target}`;
    case "WebFetch":
    case "WebSearch":
      return "Looking things up";
    case "TodoWrite":
      return "Updating the plan";
    case "Task":
    case "Agent":
      return "Handing off to a helper";
    default:
      return `Using ${entry.name}`;
  }
}

export function Working(props: { entries: ChatEntry[] }) {
  // Starts at a random phrase, so it doesn't always open the same way.
  const [index, setIndex] = createSignal(
    Math.floor(Math.random() * PHRASES.length),
  );
  const timer = window.setInterval(
    () => setIndex((i) => (i + 1) % PHRASES.length),
    2800,
  );
  onCleanup(() => window.clearInterval(timer));
  const text = () => {
    const last = props.entries[props.entries.length - 1];
    if (last?.kind === "tool" && !last.result) return toolLine(last);
    return PHRASES[index()] ?? "Working";
  };
  return (
    <div class="working" role="status" aria-live="polite">
      <span class="working-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      {/* Keyed by text, so each new line plays the fade-in again. */}
      {(() => {
        const line = text();
        return (
          <span class="working-text" title={line}>
            {line}…
          </span>
        );
      })()}
    </div>
  );
}
