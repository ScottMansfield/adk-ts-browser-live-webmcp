# ADK Live + Chrome WebMCP In-Browser Agent Demo

An end-to-end, 100% native in-browser AI agent demonstrating the **Google Agent Development Kit (`@google/adk`) Live API** bidirectional streaming together with **Chrome's native Web Model Context Protocol (WebMCP)**.

---

## Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                          Browser Window                                │
│                                                                        │
│  ┌───────────────────────────────┐  ┌────────────────────────────────┐ │
│  │   Target Web App (WebMCP)     │  │   ADK Live In-Browser Agent    │ │
│  │                               │  │                                │ │
│  │  • Interactive Booking App    │  │  • Live Voice & Text Input     │ │
│  │  • document.modelContext      │  │  • 24kHz PCM Audio Playback    │ │
│  │    .registerTool(...)         │  │  • ADK Runner + LlmAgent       │ │
│  │  • Visual Actuation Engine    │  │  • LiveRequestQueue (Bidi ws)  │ │
│  └───────────────▲───────────────┘  └────────────────▲───────────────┘ │
│                  │                                   │                 │
│                  └────────── WebMCPToolset ──────────┘                 │
│                                                                        │
│                      • getTools() via document.modelContext            │
│                      • Dynamic tool schema translation                 │
│                      • executeTool() actuation                         │
└──────────────────────────────────────┬─────────────────────────────────┘
                                       │ WebSocket (Gemini Multimodal Live)
                                       ▼
                     Gemini Live API (bidiGenerateContent)
```

### Key Highlights
- **100% Native WebMCP (No Polyfills)**: Directly interfaces with Chrome's native `document.modelContext` (`registerTool`, `getTools`, `executeTool`, and `toolchange` events).
- **In-Browser ADK Live Agent**: Runs `@google/adk`'s `LlmAgent`, `Runner`, and `LiveRequestQueue` client-side in the browser.
- **Multimodal Voice Streaming**: Captures microphone input at 16kHz Linear PCM into `LiveRequestQueue`, and plays back Gemini Live synthesized voice responses via Web Audio API at 24kHz.
- **Decoupled `adk-webmcp` Bridge**: Cleanly designed as a standalone module ready to be upstreamed into the `@google/adk` codebase under `packages/adk/src/tools/webmcp/`.
- **Model discovery instead of hardcoded ids**: Live model ids change and a wrong one fails as an opaque socket close, so the model dropdown seeds with `gemini-3.8-live` and the **load from API** link lists exactly the models your key can use over `bidiGenerateContent`.

### Troubleshooting

The demo reports Live failures rather than hanging on them. If a session does not respond:

- Open the **Trace Stream** tab. A rejected connection is logged with the server's own reason and the WebSocket close code (e.g. `API key not valid… (close code 1007)`).
- Close code `1007` usually means the selected model does not support the Live API — click **load from API** and pick one from the list.
- `window.demo` is exposed in dev (`demo.agentManager`, `demo.agentUI`, `demo.travelApp`) for poking at state from DevTools.

---

## Prerequisites: Enabling Chrome WebMCP

WebMCP is available in Chrome Canary / Dev (version 146+):

1. Launch **Chrome Canary** or **Chrome Dev**.
2. Navigate to:
   ```
   chrome://flags/#enable-webmcp-testing
   ```
3. Set the flag to **Enabled**.
4. Relaunch Chrome.

*(If launched in a browser without WebMCP enabled, the app displays a banner with setup instructions).*

---

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Run the Development Server
```bash
npm run dev
```
Open the printed URL (typically `http://localhost:5173`) in Chrome Canary.

### 3. Run Unit Tests
```bash
npm test
```

### 4. Build for Production
```bash
npm run build
```

### Optional: skip pasting the API key

Put the key in a gitignored `.env`; the field is then pre-filled in dev. A key
already typed into the browser takes precedence, so clear it from localStorage
if you switch keys.

```
GEMINI_API_KEY=...        # used by the scripts below
VITE_GEMINI_API_KEY=...   # pre-fills the field during `npm run dev`
```

The mic opens automatically on **Connect Live** — that click is the user
gesture `getUserMedia` requires. If it is blocked, the Trace Stream says so and
the mic button still works manually.

---

## Patches to `@google/adk`

There is no fork, no `patch-package`, and no edit under `node_modules`. One
runtime patch is applied at import time in `src/agent/live_agent_manager.ts`.

**Realtime audio field for `gemini-3.N-live`.** ADK picks the field from
`isGemini3xFlashLive()`, which requires both `gemini-3.` and the literal
`-flash-live`. `gemini-3.8-live` matches only the first, so ADK sends audio in
the legacy `{ media }` (`mediaChunks`) field, which the model ignores in
silence — no transcript, no reply, no error. The patch wraps
`Gemini.prototype.connect` so audio blobs go out as `{ audio }` instead.

| model | `isGemini3xFlashLive` | ADK routes | works |
| --- | --- | --- | --- |
| `gemini-3.8-live` | false | `{ media }` | no (0/6 runs) |
| `gemini-3.1-flash-live-preview` | true | `{ audio }` | yes |
| `gemini-2.5-flash-native-audio-latest` | false (native-audio branch) | `{ audio }` | yes |

Reproduce: `node scripts/live_probe.mjs gemini-3.8-live --field=media`. The
patch becomes unnecessary once ADK's predicate recognises `gemini-3.N-live`.

Two other wrappers are *not* ADK patches: `live_socket_monitor.ts` wraps the
browser `WebSocket` for diagnostics, and the `executeTool` argument encoding is
negotiated inside our own `WebMCPTool`.

---

## Diagnosing the Live connection

Two scripts exercise the Live API without the browser, which separates "my
audio pipeline is broken" from "the model is not answering":

```bash
node scripts/make_test_audio.mjs "Find me flights to Tokyo."   # renders speech to public/
node scripts/live_probe.mjs gemini-3.8-live                    # streams it to the Live API
```

`live_probe.mjs` reports the input transcript, response audio size and any tool
calls with their arguments. Flags: `--text` (send text instead of audio),
`--field=media`, `--mime=...`, `--manual` (client-driven turn boundaries).

Live responses are intermittent — an identical request can return nothing on
one attempt and work on the next, so re-run before concluding a model is
broken.

In the browser, `window.demo.audioTelemetry.framesSent` distinguishes the same
two cases: `0` means capture never produced audio, a rising count means the mic
is fine and the problem is downstream.

---

## How It Works

### 1. WebMCP Tool Registration
The target web application registers structured tools directly on the browser document:
```typescript
await document.modelContext.registerTool({
  name: 'search_flights',
  title: 'Search Flights',
  description: 'Search available flights by destination, origin, and cabin class.',
  inputSchema: {
    type: 'object',
    properties: {
      destination: { type: 'string', description: 'Destination city or airport code' },
      cabinClass: { type: 'string', enum: ['Economy', 'Premium Economy', 'Business', 'First'] }
    },
    required: ['destination']
  },
  annotations: { readOnlyHint: true },
  execute: async (args) => {
    // Updates UI and returns structured result to the model
  }
});
```

### 2. The `adk-webmcp` Bridge
The `WebMCPToolset` (extending ADK's `BaseToolset`) queries available tools via `document.modelContext.getTools()`, translates JSON Schema into Gemini function declarations (`toGeminiSchema`), and delegates execution to `document.modelContext.executeTool(...)`:
```typescript
import { WebMCPToolset } from './adk-webmcp';
import { LlmAgent, Runner } from '@google/adk';

const webmcpToolset = new WebMCPToolset();

const agent = new LlmAgent({
  name: 'ConciergeAgent',
  model: gemini,
  tools: [webmcpToolset],
});
```

### 3. Real-Time Gemini Live Interaction
1. Click **Connect Live** after providing your Gemini API key.
2. Toggle the **Microphone** button or type a prompt.
3. Speak naturally: *"Can you find me flights to Tokyo in Business class?"*
4. Gemini Live calls the `search_flights` WebMCP tool in real-time, the target web app updates visually, and Gemini confirms the booking options out loud via real-time streaming audio.

---

## Upstreaming `adk-webmcp` into `@google/adk`

The code in `src/adk-webmcp/` is organized to drop directly into `@google/adk`:
- `webmcp_tool.ts`: Extends `BaseTool`.
- `webmcp_toolset.ts`: Extends `BaseToolset`.
- `schema_utils.ts`: Schema translator matching ADK conventions.
- `webmcp.test.ts`: Complete unit test suite verifying schema translation, execution, and filtering.
