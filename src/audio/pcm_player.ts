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
  private readonly defaultSampleRate: number;
  private onPlaybackStateChange?: (isPlaying: boolean) => void;

  constructor(defaultSampleRate: number = 24000) {
    this.defaultSampleRate = defaultSampleRate;
  }

  setPlaybackStateCallback(cb: (isPlaying: boolean) => void) {
    this.onPlaybackStateChange = cb;
  }

  /**
   * Initializes or resumes the AudioContext.
   * MUST be called during a user gesture (e.g. click event) to satisfy Chrome Autoplay policies.
   */
  async resume(): Promise<AudioContext> {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  /**
   * Schedules a base64-encoded linear PCM chunk for seamless audio playback.
   */
  async playChunk(base64Data: string, sampleRate?: number) {
    const rate = sampleRate || this.defaultSampleRate;
    const ctx = await this.resume();

    const rawBytes = base64ToUint8Array(base64Data);
    if (rawBytes.byteLength < 2) return;

    const int16 = new Int16Array(rawBytes.buffer, rawBytes.byteOffset, Math.floor(rawBytes.byteLength / 2));
    const float32 = int16PCMToFloat32(int16);

    const audioBuffer = ctx.createBuffer(1, float32.length, rate);
    audioBuffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const currentTime = ctx.currentTime;
    if (this.scheduledTime < currentTime) {
      // Add a slight 25ms jitter buffer for smooth playback
      this.scheduledTime = currentTime + 0.025;
    }

    source.start(this.scheduledTime);
    this.scheduledTime += audioBuffer.duration;

    if (!this.isPlaying) {
      this.isPlaying = true;
      this.onPlaybackStateChange?.(true);
    }
    this.activeSources.push(source);

    source.onended = () => {
      this.activeSources = this.activeSources.filter((s) => s !== source);
      if (this.activeSources.length === 0) {
        this.isPlaying = false;
        this.onPlaybackStateChange?.(false);
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
    if (this.audioCtx) {
      this.scheduledTime = this.audioCtx.currentTime;
    } else {
      this.scheduledTime = 0;
    }
    if (this.isPlaying) {
      this.isPlaying = false;
      this.onPlaybackStateChange?.(false);
    }
  }

  getPlayingState(): boolean {
    return this.isPlaying;
  }
}
