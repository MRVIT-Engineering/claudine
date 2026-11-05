import { invoke } from "@tauri-apps/api/core";
import { createResource, For, type JSX, Match, Show, Switch } from "solid-js";
import { Toggle } from "../components/Common";
import {
  CodeIcon,
  MinusIcon,
  MonitorIcon,
  PaletteIcon,
  PlusIcon,
  UsersIcon,
} from "../components/Icons";
import { MergeReview } from "../components/MergeReview";
import { SETTINGS_PREVIEW } from "../mock/data";
import {
  ACCENTS,
  EDITOR_FONTS,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  navigate,
  resetAppearance,
  restartSetup,
  state,
  updateSettings,
} from "../state/store";
import type { SettingsSection } from "../types";
import { AccountList, SessionDefaults } from "./Accounts";

const SECTIONS: {
  key: SettingsSection;
  label: string;
  icon: () => JSX.Element;
}[] = [
  { key: "appearance", label: "Appearance", icon: () => <PaletteIcon /> },
  { key: "editor", label: "Editor", icon: () => <CodeIcon /> },
  { key: "accounts", label: "Claude accounts", icon: () => <UsersIcon /> },
  { key: "sessions", label: "Sessions", icon: () => <MonitorIcon /> },
];

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
      <h1>Appearance</h1>
      <p class="lede">Theme, colors and type for the whole app.</p>
      <SettingRow
        title="Theme"
        text="The whole app follows this, editor included."
      >
        <Segmented
          label="Theme"
          value={state.settings.theme}
          options={[
            { value: "dark", label: "Dark" },
            { value: "light", label: "Light" },
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
      <SettingRow
        title="Editor font"
        text="Any monospaced font installed on your machine."
      >
        <select
          class="input"
          aria-label="Editor font"
          value={state.settings.editorFont}
          onChange={(e) =>
            updateSettings({
              editorFont: EDITOR_FONTS.find(
                (f) => f.key === e.currentTarget.value,
              )?.key,
            })
          }
        >
          <For each={EDITOR_FONTS}>
            {(font) => <option value={font.key}>{font.label}</option>}
          </For>
        </select>
      </SettingRow>
      <SettingRow
        title="Font ligatures"
        text="Join character pairs like -> and == into one glyph."
      >
        <Toggle
          label="Font ligatures"
          checked={state.settings.ligatures}
          onChange={(ligatures) => updateSettings({ ligatures })}
        />
      </SettingRow>
      <button
        type="button"
        class="btn btn-lg reset-btn"
        onClick={resetAppearance}
      >
        Reset to defaults
      </button>
    </>
  );
}

function EditorSection() {
  return (
    <>
      <h1>Editor</h1>
      <p class="lede">How code and diffs are shown.</p>
      <SettingRow title="Diff layout" text="How Claude's edits are compared.">
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
      <SettingRow
        title="Wrap long lines"
        text="Otherwise long lines scroll sideways."
      >
        <Toggle
          label="Wrap long lines"
          checked={state.settings.wrapLines}
          onChange={(wrapLines) => updateSettings({ wrapLines })}
        />
      </SettingRow>
      <SettingRow
        title="Suggestions while typing"
        text="Show completions as you type. Ctrl+Space always shows them."
      >
        <Toggle
          label="Suggestions while typing"
          checked={state.settings.suggestOnType}
          onChange={(suggestOnType) => updateSettings({ suggestOnType })}
        />
      </SettingRow>
      <SettingRow
        title="Auto-close brackets"
        text="Typing ( [ { or a quote adds the closing one."
      >
        <Toggle
          label="Auto-close brackets"
          checked={state.settings.closeBrackets}
          onChange={(closeBrackets) => updateSettings({ closeBrackets })}
        />
      </SettingRow>
    </>
  );
}

function AccountsSection() {
  return (
    <>
      <h1>Claude accounts</h1>
      <p class="lede">Each account has its own Claude Code config folder.</p>
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
      <h1>Sessions</h1>
      <p class="lede">Defaults for new sessions.</p>
      <SessionDefaults />
      <SettingRow
        title="Ask before edits"
        text="New sessions wait for your approval before changing files."
      >
        <Toggle
          label="Ask before edits"
          checked={state.settings.askBeforeEdits}
          onChange={(askBeforeEdits) => updateSettings({ askBeforeEdits })}
        />
      </SettingRow>
      <SettingRow
        title="First-run setup"
        text="Mock data only: clears accounts and starts setup again."
      >
        <button type="button" class="btn" onClick={restartSetup}>
          Run setup again
        </button>
      </SettingRow>
    </>
  );
}

export function SettingsView() {
  const [version] = createResource(() =>
    invoke<string>("app_version").catch(() => "browser preview"),
  );
  const showPreview = () =>
    state.settingsSection === "appearance" ||
    state.settingsSection === "editor";
  return (
    <div class="settings-layout">
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
        <p class="muted version-note">Version {version()}</p>
      </aside>
      <main class="settings-main">
        <div class="settings-form">
          <Switch>
            <Match when={state.settingsSection === "appearance"}>
              <Appearance />
            </Match>
            <Match when={state.settingsSection === "editor"}>
              <EditorSection />
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
