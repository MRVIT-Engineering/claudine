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
import { AccountList, SessionDefaults } from "./Accounts";

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
    preview: true,
  },
  {
    key: "sessions",
    label: "Sessions",
    icon: () => <MonitorIcon />,
    preview: true,
  },
  { key: "about", label: "About", icon: () => <Mascot size={15} /> },
];

// Accounts and session defaults belong to the hidden design preview.
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

function AccountsSection() {
  return (
    <>
      <SectionHead
        title="Claude accounts"
        text="Each account has its own Claude Code config folder."
      />
      <AccountList />
      <button
        type="button"
        class="btn btn-lg reset-btn"
        onClick={() => navigate("accounts")}
      >
        <PlusIcon /> Link account
      </button>
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
                    <span class="muted">{state.accounts.length}</span>
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
              <AccountsSection />
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
