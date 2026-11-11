// Checks that every place holding Claudine's version agrees. The root Cargo.toml's
// [workspace.package] version is the source of truth; Tauri reads it from there.
// On a release tag (GITHUB_REF=refs/tags/vX.Y.Z), the tag must match too.
import { readFileSync } from "node:fs";

const cargo = readFileSync(new URL("../Cargo.toml", import.meta.url), "utf8");
const section = cargo.split("[workspace.package]")[1] ?? "";
const version = section.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
if (!version) {
  console.error("No version in [workspace.package] of Cargo.toml.");
  process.exit(1);
}

const found = {
  "apps/desktop/package.json": JSON.parse(
    readFileSync(
      new URL("../apps/desktop/package.json", import.meta.url),
      "utf8",
    ),
  ).version,
};
const tag = process.env.GITHUB_REF?.match(/^refs\/tags\/v(.+)$/)?.[1];
if (tag) found["the release tag"] = tag;

const wrong = Object.entries(found).filter(([, v]) => v !== version);
for (const [where, v] of wrong) {
  console.error(`${where} has ${v}, but Cargo.toml has ${version}.`);
}
if (wrong.length > 0) process.exit(1);
console.log(`Version ${version}`);
