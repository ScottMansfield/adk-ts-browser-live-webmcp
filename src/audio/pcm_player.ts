/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { base64ToUint8Array, int16PCMToFloat32 } from './audio_utils.ts';

export class PCMPlayer {
  private audioCtx: AudioContext | null = null;
  private scheduledTime: number = 0;
  private isPlaying: boolean = false;
  private activeSources: AudioBufferSourceNode[] = [];
  private readonly sampleRate: number;

  constructor(sampleRate: number = 24000) {
    this.sampleRate = sampleRate;
  }

  private async ensureAudioContext(): Promise<AudioContext> {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: this.sampleRate,
      });
    }
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  /**
   * Schedules a base64-encoded linear PCM chunk for seamless playback.
   */
  async playChunk(base64Data: string) {
    const ctx = await this.ensureAudioContext();
    const rawBytes = base64ToUint8Array(base64Data);
    const int16 = new Int16Array(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength / 2);
    const float32 = int16PCMToFloat32(int16);

    const audioBuffer = ctx.createBuffer(1, float32.length, this.sampleRate);
    audioBuffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const currentTime = ctx.currentTime;
    if (this.scheduledTime < currentTime) {
      this.scheduledTime = currentTime;
    }

    source.start(this.scheduledTime);
    this.scheduledTime += audioBuffer.duration;
    this.isPlaying = true;
    this.activeSources.push(source);

    source.onended = () => {
      this.activeSources = this.activeSources.filter((s) => s !== source);
      if (this.activeSources.length === 0) {
        this.isPlaying = false;
      }
    };
  }

  /**
   * Immediately stops audio playback (e.g. when interrupted by the user).
   */
  stop() {
    for (const source of this.activeSources) {
      try {
        source.stop();
        source.disconnect();
      } catch (_e) {
        // Source may already be stopped
      }
    }
    this.activeSources = [];
    this.scheduledTime = 0;
    this.isPlaying = false;
  }

  getPlayingState(): boolean {
    return this.isPlaying;
  }
}
