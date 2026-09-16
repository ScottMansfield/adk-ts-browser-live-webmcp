/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Renders a spoken phrase to public/test-speech.wav so a browser test can feed
 * it through getUserMedia in place of a real microphone.
 *
 * Usage: node scripts/make_test_audio.mjs "phrase to speak" [outfile]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { GoogleGenAI } from '@google/genai';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

const phrase = process.argv[2] ?? 'Find me flights to Tokyo.';
const out = process.argv[3] ?? new URL('../public/test-speech.wav', import.meta.url).pathname;

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

// TTS capacity is bursty; rotate models and retry rather than fail the run.
const MODELS = ['gemini-2.5-flash-preview-tts', 'gemini-3.1-flash-tts-preview', 'gemini-2.5-pro-preview-tts'];
async function synthesize() {
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    const model = MODELS[attempt % MODELS.length];
    try {
      return await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: phrase }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
        },
      });
    } catch (err) {
      lastErr = err;
      console.log(`[tts] ${model} failed (${err.status ?? '?'}), retrying…`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw lastErr;
}
const res = await synthesize();

const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
const pcm = Buffer.from(part.inlineData.data, 'base64');
const sampleRate = 24000;

// Minimal 16-bit mono WAV header.
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(sampleRate, 24);
header.writeUInt32LE(sampleRate * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(pcm.length, 40);

mkdirSync(new URL('../public/', import.meta.url).pathname, { recursive: true });
writeFileSync(out, Buffer.concat([header, pcm]));
console.log(`wrote ${out} (${(pcm.length / 2 / sampleRate).toFixed(2)}s @ ${sampleRate}Hz): "${phrase}"`);
