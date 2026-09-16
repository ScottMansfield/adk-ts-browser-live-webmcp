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
