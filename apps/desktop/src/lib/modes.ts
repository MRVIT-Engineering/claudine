import type { Effort, ModelOption } from "../backend";

// Claude Code's permission modes as Claudine names and colors them. Which ones a chat
// offers is up to it: the Editor chat never offers auto.
export type ModeTone = "manual" | "accept" | "plan" | "auto";

/** The color a mode's name is drawn in. Runs say "ask" for manual. */
export function modeTone(mode: string): ModeTone {
  switch (mode) {
    case "acceptEdits":
      return "accept";
    case "plan":
      return "plan";
    case "auto":
      return "auto";
    default:
      return "manual";
  }
}

/** Model aliases `claude` accepts, for when it hasn't listed its own models. */
export const MODEL_ALIASES: ModelOption[] = [
  {
    value: "default",
    name: "Default",
    description: "The account's default model",
    efforts: [],
  },
  { value: "opus", name: "Opus", description: "", efforts: [] },
  { value: "sonnet", name: "Sonnet", description: "", efforts: [] },
  { value: "haiku", name: "Haiku", description: "", efforts: [] },
];

const EFFORT_LABELS: Record<Effort, string> = {
  low: "Low effort",
  medium: "Medium effort",
  high: "High effort",
  xhigh: "Extra high effort",
  max: "Max effort",
};

/** The effort picker's choices for a model: its default, then the levels it takes. */
export function effortOptions(efforts: Effort[]) {
  return [
    { value: "default", label: "Default effort", hint: "Claude Code decides" },
    ...efforts.map((e) => ({ value: e, label: EFFORT_LABELS[e] })),
  ];
}

/** The model picker's choices. */
export function modelOptions(models: ModelOption[]) {
  return models.map((m) => ({
    value: m.value,
    label: m.name,
    hint: m.description || undefined,
  }));
}

/** A run's modes, as `RunPermissions` names them. Runs may use auto; the Editor chat can't. */
export const RUN_MODES = [
  {
    value: "auto",
    label: "Auto",
    hint: "Claude works without asking. Pushing, installs, deleting files and web access still ask.",
  },
  {
    value: "acceptEdits",
    label: "Accept edits",
    hint: "File edits go through. Commands ask.",
  },
  {
    value: "plan",
    label: "Plan",
    hint: "Claude explores and proposes a plan first. Starting the work asks you.",
  },
  {
    value: "ask",
    label: "Manual",
    hint: "Every edit and command waits for your Allow.",
  },
] as const;

export function runModeLabel(mode: string): string {
  return RUN_MODES.find((m) => m.value === mode)?.label ?? mode;
}
