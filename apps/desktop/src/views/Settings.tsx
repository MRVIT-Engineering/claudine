import { invoke } from "@tauri-apps/api/core";
import {
  createResource,
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from "solid-js";
import { hasBackend } from "../backend";
import { Toggle } from "../components/Common";
import {
  BoltIcon,
  CloseIcon,
  CodeIcon,
  FilesIcon,
  MinusIcon,
  MonitorIcon,
  PaletteIcon,
  PlusIcon,
  UsersIcon,
} from "../components/Icons";
import { Mascot } from "../components/Mascot";
import { MergeReview } from "../components/MergeReview";
import { Resizer } from "../components/Resizer";
import { PREVIEW_CLAUDE } from "../lib/flags";
import { SETTINGS_PREVIEW } from "../lib/samples";
import { accounts } from "../state/accounts";
import {
  ACCENTS,
  DEFAULT_SETTINGS,
  EDITOR_FONTS,
  MAX_FONT_SIZE,
  MAX_TAB_SIZE,
  MIN_FONT_SIZE,
  navigate,
  resetAllSettings,
  resetAppearance,
  resetEditor,
  resetExcludedNames,
  restartSetup,
  saveStatus,
  state,
  updatePreview,
  updateSettings,
  WIDTHS,
} from "../state/store";
import type { Settings, SettingsSection } from "../types";
import { SessionDefaults } from "./Accounts";
import { ClaudeAccountsSection } from "./ClaudeAccounts";

const ALL_SECTIONS: {
  key: SettingsSection;
  label: string;
  icon: () => JSX.Element;
  preview?: boolean;
}[] = [
  { key: "appearance", label: "Appearance", icon: () => <PaletteIcon /> },
  { key: "editor", label: "Editor", icon: () => <CodeIcon /> },
  { key: "files", label: "Files", icon: () => <FilesIcon /> },
  {
    key: "accounts",
    label: "Claude accounts",
    icon: () => <UsersIcon />,
  },
  {
    key: "agentic",
    label: "Agentic mode",
    icon: () => <BoltIcon />,
  },
  {
    key: "sessions",
    label: "Sessions",
    icon: () => <MonitorIcon />,
    preview: true,
  },
  { key: "about", label: "About", icon: () => <Mascot size={15} /> },
];

// Session defaults belong to the hidden design preview.
const SECTIONS = ALL_SECTIONS.filter(
  (section) => PREVIEW_CLAUDE || !section.preview,
);

function SettingRow(props: {
  title: string;
  text: string;
  children: JSX.Element;
}) {
  return (
    <div class="setting-row">
      <div>
        <strong>{props.title}</strong>
        <span class="muted">{props.text}</span>
      </div>
      <div class="setting-control">{props.children}</div>
    </div>
  );
}

/** A setting row with an on/off switch, for any boolean setting. */
function ToggleRow(props: {
  title: string;
  text: string;
  setting: BooleanKey;
}) {
  return (
    <SettingRow title={props.title} text={props.text}>
      <Toggle
        label={props.title}
        checked={state.settings[props.setting]}
        onChange={(value) => updateSettings({ [props.setting]: value })}
      />
    </SettingRow>
  );
}

type BooleanKey = {
  [K in keyof Settings]: Settings[K] extends boolean ? K : never;
}[keyof Settings];

function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset class="segmented">
      <legend class="sr-only">{props.label}</legend>
      <For each={props.options}>
        {(option) => (
          <label classList={{ active: props.value === option.value }}>
            <input
              class="sr-only"
              type="radio"
              checked={props.value === option.value}
              onChange={() => props.onChange(option.value)}
            />
            {option.label}
          </label>
        )}
      </For>
    </fieldset>
  );
}

function SectionHead(props: { title: string; text: string }) {
  return (
    <>
      <h1>{props.title}</h1>
      <p class="lede">{props.text}</p>
    </>
  );
}

function Preview() {
  const fontName = () =>
    EDITOR_FONTS.find((f) => f.key === state.settings.editorFont)?.label;
  const layoutName = () =>
    state.settings.diffLayout === "side" ? "Side by side" : "Inline";
  return (
    <aside class="settings-preview">
      <div class="preview-card">
        <div class="preview-head">
          <strong>Preview</strong>
          <code>pool.rs</code>
          <span class="spacer" />
          <span class="muted">
            {layoutName()} · {fontName()} {state.settings.fontSize}px
          </span>
        </div>
        <MergeReview
          path="pool.rs"
          segments={SETTINGS_PREVIEW}
          layout={state.settings.diffLayout}
          wrap={state.settings.wrapLines}
          decisionOf={() => "pending"}
        />
      </div>
      <p class="muted preview-note">
        Updates as you change settings. Ligatures turn -&gt; and == into single
        glyphs in fonts that support them.
      </p>
    </aside>
  );
}

function Appearance() {
  const clampSize = (n: number) =>
    Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, n));
  return (
    <>
      <SectionHead
        title="Appearance"
        text="Theme, colors and type for the whole app."
      />
      <SettingRow
        title="Theme"
        text="System follows your computer's light or dark mode."
      >
        <Segmented
          label="Theme"
          value={state.settings.theme}
          options={[
            { value: "dark", label: "Dark" },
            { value: "light", label: "Light" },
            { value: "system", label: "System" },
          ]}
          onChange={(theme) => updateSettings({ theme })}
        />
      </SettingRow>
      <SettingRow
        title="Accent color"
        text="Buttons, focus rings and the active tab."
      >
        <fieldset class="accent-swatches">
          <legend class="sr-only">Accent color</legend>
          <For each={ACCENTS}>
            {(accent) => (
              <label class={`accent-swatch accent-${accent}`} title={accent}>
                <input
                  class="sr-only"
                  type="radio"
                  checked={state.settings.accent === accent}
                  onChange={() => updateSettings({ accent })}
                />
                <span class="swatch-dot" />
                <span class="sr-only">{accent}</span>
              </label>
            )}
          </For>
        </fieldset>
      </SettingRow>
      <SettingRow title="Font size" text="Editor text, in pixels.">
        <input
          class="slider"
          type="range"
          aria-label="Font size"
          min={MIN_FONT_SIZE}
          max={MAX_FONT_SIZE}
          value={state.settings.fontSize}
          onInput={(e) =>
            updateSettings({ fontSize: Number(e.currentTarget.value) })
          }
        />
        <div class="stepper-input">
          <button
            type="button"
            aria-label="Decrease font size"
            disabled={state.settings.fontSize <= MIN_FONT_SIZE}
            onClick={() =>
              updateSettings({
                fontSize: clampSize(state.settings.fontSize - 1),
              })
            }
          >
            <MinusIcon size={12} />
          </button>
          <code>{state.settings.fontSize}px</code>
          <button
            type="button"
            aria-label="Increase font size"
            disabled={state.settings.fontSize >= MAX_FONT_SIZE}
            onClick={() =>
              updateSettings({
                fontSize: clampSize(state.settings.fontSize + 1),
              })
            }
          >
            <PlusIcon size={12} />
          </button>
        </div>
      </SettingRow>
      <SettingRow title="Line height" text="Space between lines of code.">
        <input
          class="slider"
          type="range"
          aria-label="Line height"
          min="1.2"
          max="2.2"
          step="0.1"
          value={state.settings.lineHeight}
          onInput={(e) =>
            updateSettings({ lineHeight: Number(e.currentTarget.value) })
          }
        />
        <code class="setting-value">
          {state.settings.lineHeight.toFixed(1)}
        </code>
      </SettingRow>
      <SettingRow
        title="Editor font"
        text="Uses the font if it's installed on your machine."
      >
        <select
          class="input"
          aria-label="Editor font"
          value={state.settings.editorFont}
          onChange={(e) => {
            const font = EDITOR_FONTS.find(
              (f) => f.key === e.currentTarget.value,
            );
            if (font) updateSettings({ editorFont: font.key });
          }}
        >
          <For each={EDITOR_FONTS}>
            {(font) => <option value={font.key}>{font.label}</option>}
          </For>
        </select>
      </SettingRow>
      <ToggleRow
        title="Font ligatures"
        text="Join character pairs like -> and == into one glyph."
        setting="ligatures"
      />
      <button
        type="button"
        class="btn btn-lg reset-btn"
        onClick={resetAppearance}
      >
        Reset appearance
      </button>
    </>
  );
}

function EditorSection() {
  const tabSizes = [2, 3, 4, 6, 8].filter((n) => n <= MAX_TAB_SIZE);
  return (
    <>
      <SectionHead
        title="Editor"
        text="How code is shown and edited. Changes apply to open files right away."
      />
      <SettingRow title="Tab size" text="Columns per indent level.">
        <select
          class="input input-narrow"
          aria-label="Tab size"
          value={state.settings.tabSize}
          onChange={(e) =>
            updateSettings({ tabSize: Number(e.currentTarget.value) })
          }
        >
          <For each={tabSizes}>{(n) => <option value={n}>{n}</option>}</For>
        </select>
      </SettingRow>
      <SettingRow title="Indent with" text="What Tab and new lines insert.">
        <Segmented
          label="Indent with"
          value={state.settings.insertSpaces ? "spaces" : "tabs"}
          options={[
            { value: "spaces", label: "Spaces" },
            { value: "tabs", label: "Tabs" },
          ]}
          onChange={(value) =>
            updateSettings({ insertSpaces: value === "spaces" })
          }
        />
      </SettingRow>
      <ToggleRow
        title="Wrap long lines"
        text="Otherwise long lines scroll sideways."
        setting="wrapLines"
      />
      <ToggleRow
        title="Line numbers"
        text="Show numbers in the gutter."
        setting="lineNumbers"
      />
      <ToggleRow
        title="Highlight current line"
        text="Shade the line the cursor is on."
        setting="highlightActiveLine"
      />
      <SettingRow title="Show whitespace" text="Draw spaces and tabs.">
        <Segmented
          label="Show whitespace"
          value={state.settings.whitespace}
          options={[
            { value: "none", label: "None" },
            { value: "trailing", label: "Trailing" },
            { value: "all", label: "All" },
          ]}
          onChange={(whitespace) => updateSettings({ whitespace })}
        />
      </SettingRow>
      <ToggleRow
        title="Bracket matching"
        text="Highlight the bracket that matches the one at the cursor."
        setting="bracketMatching"
      />
      <ToggleRow
        title="Folding"
        text="Arrows in the gutter to collapse blocks."
        setting="foldGutter"
      />
      <ToggleRow
        title="Cursor blinking"
        text="Off keeps the cursor solid."
        setting="cursorBlinking"
      />
      <ToggleRow
        title="Scroll past end"
        text="Let the last line scroll up to the top."
        setting="scrollPastEnd"
      />
      <ToggleRow
        title="Suggestions while typing"
        text="Show completions as you type. Ctrl+Space always shows them."
        setting="suggestOnType"
      />
      <ToggleRow
        title="Auto-close brackets"
        text="Typing ( [ { or a quote adds the closing one."
        setting="closeBrackets"
      />
      <SettingRow title="Diff layout" text="How proposed changes are compared.">
        <Segmented
          label="Diff layout"
          value={state.settings.diffLayout}
          options={[
            { value: "side", label: "Side by side" },
            { value: "inline", label: "Inline" },
          ]}
          onChange={(diffLayout) => updateSettings({ diffLayout })}
        />
      </SettingRow>
      <button type="button" class="btn btn-lg reset-btn" onClick={resetEditor}>
        Reset editor settings
      </button>
    </>
  );
}

/** An editable list of commands, one chip each. */
function CommandList(props: {
  label: string;
  placeholder: string;
  values: string[];
  empty: string;
  disabled?: boolean;
  onChange: (values: string[]) => void;
}) {
  const [text, setText] = createSignal("");
  const add = (event: SubmitEvent) => {
    event.preventDefault();
    const value = text().trim();
    if (!value || props.values.includes(value)) return;
    props.onChange([...props.values, value]);
    setText("");
  };
  return (
    <>
      <ul class="name-chips">
        <For each={props.values}>
          {(value) => (
            <li class="name-chip">
              <code>{value}</code>
              <button
                type="button"
                class="icon-btn"
                aria-label={`Remove ${value}`}
                disabled={props.disabled}
                onClick={() =>
                  props.onChange(props.values.filter((v) => v !== value))
                }
              >
                <CloseIcon size={11} />
              </button>
            </li>
          )}
        </For>
        <Show when={props.values.length === 0}>
          <li class="muted">{props.empty}</li>
        </Show>
      </ul>
      <form class="row" onSubmit={add}>
        <input
          class="input input-name"
          aria-label={props.label}
          placeholder={props.placeholder}
          disabled={props.disabled}
          value={text()}
          onInput={(e) => setText(e.currentTarget.value)}
        />
        <button
          type="submit"
          class="btn"
          disabled={props.disabled || !text().trim()}
        >
          Add
        </button>
      </form>
    </>
  );
}

function NumberSetting(props: {
  label: string;
  value: number;
  max: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <label class="number-setting">
      <input
        class="input input-number"
        type="number"
        min="0"
        max={props.max}
        aria-label={props.label}
        value={props.value}
        onChange={(e) => {
          const n = Math.round(Number(e.currentTarget.value));
          props.onChange(
            Number.isFinite(n) ? Math.min(props.max, Math.max(0, n)) : 0,
          );
        }}
      />
      <span class="muted">{props.unit}</span>
    </label>
  );
}

function AgenticSection() {
  const off = () => !state.settings.prePrReview;
  return (
    <>
      <SectionHead
        title="Agentic mode"
        text="How runs work: Claude Code on its own, on a branch, then a pre-PR review."
      />
      <ToggleRow
        title="Pre-PR review"
        text="A finished run waits for your review. Off: it commits straight to its branch."
        setting="prePrReview"
      />
      <SettingRow
        title="Default mode for new runs"
        text="Pushing, installing packages, deleting files, web access and your deny list always ask."
      >
        <Segmented
          label="Default mode for new runs"
          value={state.settings.runPermissions}
          options={[
            { value: "auto", label: "Auto" },
            { value: "acceptEdits", label: "Accept edits" },
            { value: "plan", label: "Plan" },
            { value: "ask", label: "Manual" },
          ]}
          onChange={(runPermissions) => updateSettings({ runPermissions })}
        />
      </SettingRow>
      <SettingRow
        title="When you approve"
        text="Opening a PR pushes the branch and runs gh pr create. It needs the GitHub CLI, signed in."
      >
        <Segmented
          label="When you approve"
          value={state.settings.onApprove}
          options={[
            { value: "pr", label: "Open GitHub PR" },
            { value: "commit", label: "Commit only" },
          ]}
          onChange={(onApprove) => updateSettings({ onApprove })}
        />
      </SettingRow>
      <div classList={{ "is-disabled": off() }}>
        <ToggleRow
          title="Explain each file"
          text="Claude writes a short explanation of every changed file for the review."
          setting="explainFiles"
        />
        <ToggleRow
          title="Run checks before review"
          text="Runs the check commands in the run's worktree and shows the results."
          setting="runChecks"
        />
        <div class="setting-block">
          <strong>Check commands</strong>
          <span class="muted">
            Empty: detected from the project (cargo test, npm test, pytest).
            Commands you add here run only after you confirm them once.
          </span>
          <CommandList
            label="Check command"
            placeholder="cargo clippy -- -D warnings"
            values={state.settings.checkCommands}
            empty="Detected from the project."
            disabled={off() || !state.settings.runChecks}
            onChange={(checkCommands) => updateSettings({ checkCommands })}
          />
        </div>
      </div>
      <ToggleRow
        title="Separate git worktree per run"
        text="Each run gets its own folder, so several can work at once while you edit."
        setting="worktreePerRun"
      />
      <SettingRow
        title="Branch prefix"
        text="New run branches are named <prefix><task>."
      >
        <input
          class="input input-name"
          aria-label="Branch prefix"
          value={state.settings.branchPrefix}
          onChange={(e) =>
            updateSettings({ branchPrefix: e.currentTarget.value.trim() })
          }
        />
      </SettingRow>
      <div class="setting-block">
        <strong>Deny list</strong>
        <span class="muted">
          Commands that always ask, whatever the permissions. Matches the start
          of the command.
        </span>
        <CommandList
          label="Command that always asks"
          placeholder="terraform apply"
          values={state.settings.denyList}
          empty="Nothing extra."
          onChange={(denyList) => updateSettings({ denyList })}
        />
      </div>
      <SettingRow
        title="Limits per run"
        text="Stop a run after this long, or this many turns. 0 means no limit."
      >
        <div class="row">
          <NumberSetting
            label="Maximum minutes per run"
            value={state.settings.maxRunMinutes}
            max={24 * 60}
            unit="min"
            onChange={(maxRunMinutes) => updateSettings({ maxRunMinutes })}
          />
          <NumberSetting
            label="Maximum turns per run"
            value={state.settings.maxRunTurns}
            max={1000}
            unit="turns"
            onChange={(maxRunTurns) => updateSettings({ maxRunTurns })}
          />
        </div>
      </SettingRow>
    </>
  );
}

function FilesSection() {
  const [name, setName] = createSignal("");
  const problem = () => {
    const value = name().trim();
    if (!value) return "";
    if (value.includes("/") || value.includes("\\")) {
      return "Use a name, not a path.";
    }
    if (state.settings.excludedNames.includes(value)) return "Already hidden.";
    return "";
  };
  const add = (event: SubmitEvent) => {
    event.preventDefault();
    const value = name().trim();
    if (!value || problem()) return;
    updateSettings({ excludedNames: [...state.settings.excludedNames, value] });
    setName("");
  };
  const remove = (value: string) =>
    updateSettings({
      excludedNames: state.settings.excludedNames.filter((n) => n !== value),
    });

  return (
    <>
      <SectionHead
        title="Files"
        text="What the explorer, Go to file and search leave out."
      />
      <div class="setting-block">
        <strong>Hidden names</strong>
        <span class="muted">
          Files and folders with these exact names are hidden anywhere in the
          project. Names only, not paths.
        </span>
        <ul class="name-chips">
          <For each={state.settings.excludedNames}>
            {(excluded) => (
              <li class="name-chip">
                <code>{excluded}</code>
                <button
                  type="button"
                  class="icon-btn"
                  aria-label={`Stop hiding ${excluded}`}
                  onClick={() => remove(excluded)}
                >
                  <CloseIcon size={11} />
                </button>
              </li>
            )}
          </For>
          <Show when={state.settings.excludedNames.length === 0}>
            <li class="muted">Nothing is hidden.</li>
          </Show>
        </ul>
        <form class="row" onSubmit={add}>
          <input
            class="input input-name"
            aria-label="Name to hide"
            placeholder="dist"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
          />
          <button
            type="submit"
            class="btn"
            disabled={!name().trim() || !!problem()}
          >
            Hide
          </button>
          <Show when={problem()}>
            <span class="field-error">{problem()}</span>
          </Show>
        </form>
      </div>
      <button
        type="button"
        class="btn btn-lg reset-btn"
        onClick={resetExcludedNames}
      >
        Reset hidden names
      </button>
    </>
  );
}

function AboutSection() {
  const [version] = createResource(() =>
    invoke<string>("app_version").catch(() => "browser preview"),
  );
  const [confirming, setConfirming] = createSignal(false);
  return (
    <>
      <div class="about-head">
        <Mascot size={56} />
        <div>
          <h1>Claudine</h1>
          <p class="muted">Version {version()}</p>
        </div>
      </div>
      <SettingRow
        title="Where settings are kept"
        text={
          hasBackend()
            ? "In your user's app data folder on this computer, so everyone who uses it has their own."
            : "In this browser only. The desktop app keeps them per user."
        }
      >
        <span class="muted">settings.json</span>
      </SettingRow>
      <SettingRow
        title="First-run setup"
        text="Show the welcome steps again. Your settings stay."
      >
        <button type="button" class="btn" onClick={restartSetup}>
          Run setup again
        </button>
      </SettingRow>
      <SettingRow
        title="Reset all settings"
        text="Every setting back to its default, including hidden names and sidebar widths."
      >
        <Show
          when={confirming()}
          fallback={
            <button
              type="button"
              class="btn btn-danger"
              onClick={() => setConfirming(true)}
            >
              Reset all…
            </button>
          }
        >
          <button
            type="button"
            class="btn"
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-danger-solid"
            onClick={() => {
              resetAllSettings();
              setConfirming(false);
            }}
          >
            Reset everything
          </button>
        </Show>
      </SettingRow>
    </>
  );
}

function SessionsSection() {
  return (
    <>
      <SectionHead title="Sessions" text="Defaults for new sessions." />
      <SessionDefaults />
      <SettingRow
        title="Ask before edits"
        text="New sessions wait for your approval before changing files."
      >
        <Toggle
          label="Ask before edits"
          checked={state.preview.askBeforeEdits}
          onChange={(askBeforeEdits) => updatePreview({ askBeforeEdits })}
        />
      </SettingRow>
    </>
  );
}

export function SettingsView() {
  const showPreview = () =>
    state.settingsSection === "appearance" ||
    state.settingsSection === "editor";
  return (
    <div class="settings-layout">
      <div class="sidebar-slot">
        <aside class="settings-nav">
          <h2 class="section-title">Settings</h2>
          <nav aria-label="Settings">
            <For each={SECTIONS}>
              {(section) => (
                <button
                  type="button"
                  class="settings-link"
                  classList={{ active: state.settingsSection === section.key }}
                  onClick={() => navigate("settings", section.key)}
                >
                  {section.icon()}
                  <span>{section.label}</span>
                  <Show when={section.key === "accounts"}>
                    <span class="spacer" />
                    <span class="muted">{accounts.list.length || ""}</span>
                  </Show>
                </button>
              )}
            </For>
          </nav>
          <span class="spacer" />
          <p
            class="muted version-note"
            classList={{ "save-error": saveStatus() === "error" }}
          >
            {saveStatus() === "error"
              ? "Couldn't save settings."
              : "Settings save automatically."}
          </p>
        </aside>
        <Resizer
          label="Resize settings navigation"
          edge="right"
          value={state.settings.settingsNavWidth}
          min={WIDTHS.settingsNavWidth[0]}
          max={WIDTHS.settingsNavWidth[1]}
          defaultValue={DEFAULT_SETTINGS.settingsNavWidth}
          onChange={(settingsNavWidth) => updateSettings({ settingsNavWidth })}
        />
      </div>
      <main class="settings-main">
        <div class="settings-form">
          <Switch>
            <Match when={state.settingsSection === "appearance"}>
              <Appearance />
            </Match>
            <Match when={state.settingsSection === "editor"}>
              <EditorSection />
            </Match>
            <Match when={state.settingsSection === "files"}>
              <FilesSection />
            </Match>
            <Match when={state.settingsSection === "about"}>
              <AboutSection />
            </Match>
            <Match when={state.settingsSection === "accounts"}>
              <ClaudeAccountsSection />
            </Match>
            <Match when={state.settingsSection === "agentic"}>
              <AgenticSection />
            </Match>
            <Match when={state.settingsSection === "sessions"}>
              <SessionsSection />
            </Match>
          </Switch>
        </div>
        <Show when={showPreview()}>
          <Preview />
        </Show>
      </main>
    </div>
  );
}
