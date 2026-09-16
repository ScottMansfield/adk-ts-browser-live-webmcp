/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Drives a two-turn search -> select conversation over the Live API and dumps
 * every toolCall frame verbatim.
 *
 * Purpose: determine whether the model streams function-call arguments
 * progressively (partialArgs / willContinue). ADK's live aggregator has no
 * reassembly for that, so if it does, arguments arrive empty.
 *
 * Usage: node scripts/toolcall_probe.mjs [model]
 */
import { readFileSync } from 'node:fs';
import { GoogleGenAI, Modality } from '@google/genai';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

const MODEL = process.argv[2] ?? 'gemini-3.8-live';
const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

const DECLS = [
  {
    name: 'search_flights',
    description: 'Search available flights by destination.',
    parameters: {
      type: 'OBJECT',
      properties: { destination: { type: 'STRING', description: 'City or airport code' } },
      required: ['destination'],
    },
  },
  {
    name: 'select_flight',
    description:
      'Selects a flight from the search results. flightId is required and must be one of the ids returned by search_flights.',
    parameters: {
      type: 'OBJECT',
      properties: { flightId: { type: 'STRING', description: 'e.g. SB-101, SB-102, SB-103' } },
      required: ['flightId'],
    },
  },
];

const rawToolCalls = [];
let sawPartialArgs = false;

const session = await ai.live.connect({
  model: MODEL,
  config: {
    responseModalities: [Modality.AUDIO],
    outputAudioTranscription: {},
    tools: [{ functionDeclarations: DECLS }],
  },
  callbacks: {
    onopen: () => console.log('[live] open'),
    onmessage: (m) => {
      if (m.toolCall?.functionCalls) {
        for (const fc of m.toolCall.functionCalls) {
          rawToolCalls.push(fc);
          if (fc.partialArgs !== undefined || fc.willContinue !== undefined) sawPartialArgs = true;
          // Respond so the conversation can continue to the next turn.
          const response =
            fc.name === 'search_flights'
              ? {
                  count: 3,
                  flights: [
                    { id: 'SB-101', cabinClass: 'Economy' },
                    { id: 'SB-102', cabinClass: 'Premium Economy' },
                    { id: 'SB-103', cabinClass: 'Business' },
                  ],
                }
              : { ok: true, selected: fc.args?.flightId ?? null };
          session.sendToolResponse({
            functionResponses: [{ id: fc.id, name: fc.name, response }],
          });
        }
      }
    },
    onerror: (e) => console.log('[live] error', e?.message ?? e),
    onclose: (e) => console.log('[live] close', e?.code, e?.reason),
  },
});

function say(text) {
  session.sendClientContent({ turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true });
}

say('Find me flights to Tokyo.');
await new Promise((r) => setTimeout(r, 10000));
say('Select the business class flight.');
await new Promise((r) => setTimeout(r, 12000));

try {
  session.close();
} catch {}

console.log('\n=== RAW toolCall frames ===');
for (const fc of rawToolCalls) console.log(JSON.stringify(fc));
console.log('\nstreamed partial args seen:', sawPartialArgs);
const select = rawToolCalls.filter((c) => c.name === 'select_flight');
console.log('select_flight calls:', select.length);
console.log('select_flight with a flightId:', select.filter((c) => c.args?.flightId).length);
console.log('select_flight with empty args:', select.filter((c) => !c.args || Object.keys(c.args).length === 0).length);
