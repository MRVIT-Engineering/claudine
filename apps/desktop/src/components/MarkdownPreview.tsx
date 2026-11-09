// Renders lib/markdown.ts's tree as DOM nodes. Text only ever becomes text nodes, raw
// HTML is shown as its text, images aren't loaded, and web links don't navigate: the
// webview has no way to open the browser, and must never leave the app.
import { createMemo, For, Match, Show, Switch } from "solid-js";
import { Dynamic } from "solid-js/web";
import { buffers } from "../lib/buffers";
import {
  type Block,
  type Inline,
  type ListItem,
  parseMarkdown,
} from "../lib/markdown";
import { openFile, state } from "../state/store";

/** The file as it is in the editor, unsaved edits included. */
function currentText(path: string): string {
  const buffer = buffers.get(path);
  if (buffer) return buffer.state.doc.toString();
  const file = state.files[path];
  return file?.status === "ready" ? file.value : "";
}

/** A link to another project file, resolved against `from`'s folder. */
function projectPath(href: string, from: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) return null;
  const target = decodeURI(href.split("#")[0] ?? "");
  if (!target) return null;
  const parts = target.startsWith("/") ? [] : from.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else if (part && part !== ".") {
      parts.push(part);
    }
  }
  return parts.join("/") || null;
}

function htmlText(html: string): string {
  return html
    .replace(/<img\b[^>]*?\balt="([^"]*)"[^>]*>/gi, " [image: $1] ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function Inlines(props: { nodes: Inline[]; from: string }) {
  return (
    <For each={props.nodes}>
      {(node) => <InlineNode node={node} from={props.from} />}
    </For>
  );
}

function InlineNode(props: { node: Inline; from: string }) {
  const node = props.node;
  switch (node.kind) {
    case "text":
      return <>{node.text}</>;
    case "code":
      return <code>{node.text}</code>;
    case "strong":
      return (
        <strong>
          <Inlines nodes={node.children} from={props.from} />
        </strong>
      );
    case "em":
      return (
        <em>
          <Inlines nodes={node.children} from={props.from} />
        </em>
      );
    case "del":
      return (
        <del>
          <Inlines nodes={node.children} from={props.from} />
        </del>
      );
    case "break":
      return <br />;
    case "image":
      return (
        <span class="md-image" title={node.src}>
          [image{node.alt ? `: ${node.alt}` : ""}]
        </span>
      );
    case "link": {
      const target = projectPath(node.href, props.from);
      return (
        <Show
          when={target}
          fallback={
            <span class="md-link" title={node.href}>
              <Inlines nodes={node.children} from={props.from} />
            </span>
          }
        >
          {(path) => (
            <button
              type="button"
              class="md-link md-file-link"
              title={`Open ${path()}`}
              onClick={() => openFile(path())}
            >
              <Inlines nodes={node.children} from={props.from} />
            </button>
          )}
        </Show>
      );
    }
  }
}

function Item(props: { item: ListItem; from: string }) {
  return (
    <li classList={{ "md-task": props.item.checked !== null }}>
      <Show when={props.item.checked !== null}>
        <input
          type="checkbox"
          disabled
          checked={props.item.checked === true}
          aria-label={props.item.checked ? "Done" : "Not done"}
        />
      </Show>
      <Blocks blocks={props.item.children} from={props.from} />
    </li>
  );
}

function BlockNode(props: { block: Block; from: string }) {
  const block = props.block;
  switch (block.kind) {
    case "heading":
      return (
        <Dynamic component={`h${block.level}`}>
          <Inlines nodes={block.children} from={props.from} />
        </Dynamic>
      );
    case "paragraph":
      return (
        <p>
          <Inlines nodes={block.children} from={props.from} />
        </p>
      );
    case "code":
      return (
        <pre class="md-code">
          <code>{block.text}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote>
          <Blocks blocks={block.children} from={props.from} />
        </blockquote>
      );
    case "list":
      return (
        <Switch>
          <Match when={block.ordered}>
            <ol start={block.start}>
              <For each={block.items}>
                {(item) => <Item item={item} from={props.from} />}
              </For>
            </ol>
          </Match>
          <Match when={!block.ordered}>
            <ul>
              <For each={block.items}>
                {(item) => <Item item={item} from={props.from} />}
              </For>
            </ul>
          </Match>
        </Switch>
      );
    case "table":
      return (
        <div class="md-table">
          <table>
            <thead>
              <tr>
                <For each={block.head}>
                  {(cell, n) => (
                    <th
                      class={
                        block.align[n()] ? `align-${block.align[n()]}` : ""
                      }
                    >
                      <Inlines nodes={cell} from={props.from} />
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody>
              <For each={block.rows}>
                {(row) => (
                  <tr>
                    <For each={row}>
                      {(cell, n) => (
                        <td
                          class={
                            block.align[n()] ? `align-${block.align[n()]}` : ""
                          }
                        >
                          <Inlines nodes={cell} from={props.from} />
                        </td>
                      )}
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      );
    case "html": {
      const text = htmlText(block.text);
      return (
        <Show when={text}>
          <p class="md-html" title="HTML, shown as text">
            {text}
          </p>
        </Show>
      );
    }
    case "rule":
      return <hr />;
  }
}

function Blocks(props: { blocks: Block[]; from: string }) {
  return (
    <For each={props.blocks}>
      {(block) => <BlockNode block={block} from={props.from} />}
    </For>
  );
}

/** The rendered file, in place of the editor. */
export function MarkdownPreview(props: { path: string }) {
  const blocks = createMemo(() => parseMarkdown(currentText(props.path)));
  return (
    // Focusable, so the keyboard can scroll it.
    <section
      class="md-preview"
      tabindex="0"
      aria-label={`Preview of ${props.path}`}
    >
      <article class="md-body">
        <Blocks blocks={blocks()} from={props.path} />
      </article>
    </section>
  );
}
