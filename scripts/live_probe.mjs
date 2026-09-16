/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * End-to-end probe of the Gemini Live audio path, independent of the browser.
 *
 * Synthesizes a spoken utterance with a TTS model, resamples it to the 16 kHz
 * linear PCM the Live API expects, streams it in 32 ms chunks exactly as the
 * browser recorder does, and reports what comes back - including whether tool
 * calls arrive with their arguments populated.
 *
 * Usage: node scripts/live_probe.mjs [model] [--field=audio|media]
 */
import { readFileSync } from 'node:fs';
import { GoogleGenAI, Modality } from '@google/genai';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);
const API_KEY = env.GEMINI_API_KEY;
if (!API_KEY) throw new Error('GEMINI_API_KEY missing from .env');

const MODEL = process.argv[2] ?? 'gemini-3.8-live';
const FIELD = (process.argv.find((a) => a.startsWith('--field=')) ?? '--field=audio').split('=')[1];
const PHRASE = 'Find me flights to Tokyo.';

const ai = new GoogleGenAI({ apiKey: API_KEY });

/** Decimates 24 kHz PCM16 to 16 kHz by linear interpolation. */
function resample(int16, fromRate, toRate) {
  if (fromRate === toRate) return int16;
  const ratio = fromRate / toRate;
  const out = new Int16Array(Math.floor(int16.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const src = i * ratio;
    const lo = Math.floor(src);
    const hi = Math.min(lo + 1, int16.length - 1);
    out[i] = int16[lo] + (int16[hi] - int16[lo]) * (src - lo);
  }
  return out;
}

async function synthesize(text) {
  console.log(`[tts] synthesizing "${text}"`);
  const res = await ai.models.generateContent({
    model: 'gemini-2.5-flash-preview-tts',
    contents: [{ role: 'user', parts: [{ text }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
    },
  });
  const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part) throw new Error('TTS returned no audio');
  const buf = Buffer.from(part.inlineData.data, 'base64');
  const pcm24 = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2));
  const pcm16 = resample(pcm24, 24000, 16000);
  console.log(`[tts] ${(pcm16.length / 16000).toFixed(2)}s of 16kHz PCM`);
  return pcm16;
}

const SEARCH_FLIGHTS = {
  name: 'search_flights',
  description: 'Search available flights by destination.',
  parameters: {
    type: 'OBJECT',
    properties: {
      destination: { type: 'STRING', description: 'Destination city or airport code' },
    },
    required: ['destination'],
  },
};

async function main() {
  const pcm = await synthesize(PHRASE);

  let audioBytes = 0;
  let transcript = '';
  const toolCalls = [];
  let closed = null;
  let setupOk = false;

  console.log(`[live] connecting model=${MODEL} field=${FIELD}`);
  const session = await ai.live.connect({
    model: MODEL,
    config: {
      responseModalities: [Modality.AUDIO],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      tools: [{ functionDeclarations: [SEARCH_FLIGHTS] }],
      ...(process.argv.includes('--manual')
        ? { realtimeInputConfig: { automaticActivityDetection: { disabled: true } } }
        : {}),
    },
    callbacks: {
      onopen: () => console.log('[live] socket open'),
      onmessage: (m) => {
        if (m.setupComplete) setupOk = true;
        const sc = m.serverContent;
        for (const p of sc?.modelTurn?.parts ?? []) {
          if (p.inlineData?.data) audioBytes += Buffer.from(p.inlineData.data, 'base64').length;
        }
        if (sc?.inputTranscription?.text) transcript += sc.inputTranscription.text;
        for (const fc of m.toolCall?.functionCalls ?? []) {
          toolCalls.push({ name: fc.name, args: fc.args });
        }
      },
      onerror: (e) => console.log('[live] error', e?.message ?? e),
      onclose: (e) => {
        closed = { code: e?.code, reason: e?.reason };
      },
    },
  });

  if (process.argv.includes('--text')) {
    console.log('[live] sending text turn instead of audio');
    session.sendClientContent({
      turns: [{ role: 'user', parts: [{ text: PHRASE }] }],
      turnComplete: true,
    });
    await new Promise((r) => setTimeout(r, 12000));
    try {
      session.close();
    } catch {}
    console.log('\n=== RESULT ===');
    console.log('setupComplete:      ', setupOk);
    console.log('response audio bytes:', audioBytes);
    console.log('tool calls:         ', JSON.stringify(toolCalls));
    console.log('close:              ', JSON.stringify(closed));
    return;
  }

  // Trailing silence so server-side VAD sees end-of-speech.
  const silence = new Int16Array(16000);
  const stream = new Int16Array(pcm.length + silence.length);
  stream.set(pcm, 0);
  stream.set(silence, pcm.length);

  const MIME =
    (process.argv.find((a) => a.startsWith('--mime=')) ?? '--mime=audio/pcm;rate=16000').slice(7);
  const manual = process.argv.includes('--manual');
  if (manual) session.sendRealtimeInput({ activityStart: {} });

  // Stream in 32 ms chunks (512 samples) at realtime pace, like the recorder.
  const CHUNK = 512;
  for (let i = 0; i < stream.length; i += CHUNK) {
    const slice = stream.subarray(i, Math.min(i + CHUNK, stream.length));
    const b64 = Buffer.from(slice.buffer, slice.byteOffset, slice.byteLength).toString('base64');
    const blob = { mimeType: MIME, data: b64 };
    session.sendRealtimeInput(FIELD === 'audio' ? { audio: blob } : { media: blob });
    await new Promise((r) => setTimeout(r, 32));
  }
  if (manual) session.sendRealtimeInput({ activityEnd: {} });
  console.log('[live] audio sent (realtime paced + 1s silence); waiting for response');

  await new Promise((r) => setTimeout(r, 12000));
  try {
    session.close();
  } catch {}

  console.log('\n=== RESULT ===');
  console.log('setupComplete:      ', setupOk);
  console.log('input transcript:   ', JSON.stringify(transcript));
  console.log('response audio bytes:', audioBytes);
  console.log('tool calls:         ', JSON.stringify(toolCalls));
  console.log('close:              ', JSON.stringify(closed));
}

main().catch((e) => {
  console.error('probe failed:', e?.message ?? e);
  process.exit(1);
});
