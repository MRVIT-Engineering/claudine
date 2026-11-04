import { invoke } from "@tauri-apps/api/core";
import { createResource } from "solid-js";

export function App() {
  const [version] = createResource(() => invoke<string>("app_version"));

  return <p>my-editor {version()}</p>;
}
