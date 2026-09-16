# WebMCP Toolset for Google ADK (`@google/adk`)

This module provides native integration between the **W3C Web Model Context Protocol (WebMCP)** browser standard and the **Google Agent Development Kit (`@google/adk`)**.

It is architected as a standalone module so that it can be cleanly moved/upstreamed into the `@google/adk` repository under `packages/adk/src/tools/webmcp/`.

---

## Architecture

- **`WebMCPTool`** (subclasses `BaseTool`):
  Wraps a native WebMCP `RegisteredTool` descriptor. Automatically translates JSON Schema into Gemini function declarations (`toGeminiSchema`), marks consequential actions for human confirmation, and delegates execution to `document.modelContext.executeTool(tool, args, { signal })`.

- **`WebMCPToolset`** (subclasses `BaseToolset`):
  Dynamically queries `document.modelContext.getTools()`, applies tool filtering and optional name prefixes, and listens for live `toolchange` events when web pages dynamically register or unregister tools.

- **`schema_utils.ts`**:
  Handles JSON Schema / OpenAPI to Gemini Schema conversion, preserving type definitions, enums, required properties, and object hierarchies.

### Argument encoding

`executeTool` originally took arguments as a JSON **string**; Chrome moved to a
plain object and deprecated the string form in Chrome 155. Passing an object to
an older build makes it parse `"[object Object]"` and return
`{ error: "Failed to parse input arguments" }` without ever running the tool.

`WebMCPTool` therefore probes once: it tries the object form, and only on that
specific parse failure retries with `JSON.stringify`, caching whichever the
browser accepted. A parse failure means the tool did not execute, so the retry
cannot double-apply a side effect. Unrelated tool errors propagate untouched.

---

## Upstreaming into `@google/adk`

When moving into `@google/adk`:
1. Copy the `adk-webmcp` folder to `packages/adk/src/tools/webmcp/`.
2. Re-export `WebMCPToolset` and `WebMCPTool` from `packages/adk/src/index.ts` and `packages/adk/src/common.ts`.
3. Add `webmcp-types` to peerDependencies or devDependencies in `@google/adk/package.json`.
