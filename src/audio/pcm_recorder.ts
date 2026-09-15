/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { arrayBufferToBase64, float32ToInt16PCM } from './audio_utils.ts';

export interface RecorderCallbacks {
  onAudioChunk: (base64Data: string) => void;
  onVolumeChange?: (volumePercent: number) => void;
}

export class PCMRecorder {
  private mediaStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private isRecording: boolean = false;
  private readonly targetSampleRate = 16000;

  async start(callbacks: RecorderCallbacks) {
    if (this.isRecording) return;

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const sourceSampleRate = this.audioCtx.sampleRate;
    this.source = this.audioCtx.createMediaStreamSource(this.mediaStream);

    // Buffer size 2048 or 4096 gives ~50-100ms chunks
    const bufferSize = 2048;
    this.processor = this.audioCtx.createScriptProcessor(bufferSize, 1, 1);

    this.processor.onaudioprocess = (e) => {
      if (!this.isRecording) return;
      const inputData = e.inputBuffer.getChannelData(0);

      // Calculate RMS for volume visualization
      let sumSquares = 0;
      for (let i = 0; i < inputData.length; i++) {
        sumSquares += inputData[i] * inputData[i];
      }
      const rms = Math.sqrt(sumSquares / inputData.length);
      const volume = Math.min(100, Math.round(rms * 400));
      callbacks.onVolumeChange?.(volume);

      // Downsample to 16kHz if source sample rate differs
      const resampledData = this.resampleAudio(inputData, sourceSampleRate, this.targetSampleRate);
      const pcm16 = float32ToInt16PCM(resampledData);
      const base64Chunk = arrayBufferToBase64(pcm16.buffer);

      callbacks.onAudioChunk(base64Chunk);
    };

    this.source.connect(this.processor);
    this.processor.connect(this.audioCtx.destination);
    this.isRecording = true;
  }

  private resampleAudio(
    audioData: Float32Array,
    fromSampleRate: number,
    toSampleRate: number
  ): Float32Array {
    if (fromSampleRate === toSampleRate) {
      return audioData;
    }
    const ratio = fromSampleRate / toSampleRate;
    const newLength = Math.round(audioData.length / ratio);
    const result = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const originalIndex = i * ratio;
      const lower = Math.floor(originalIndex);
      const upper = Math.min(lower + 1, audioData.length - 1);
      const weight = originalIndex - lower;
      result[i] = audioData[lower] * (1 - weight) + audioData[upper] * weight;
    }
    return result;
  }

  stop() {
    this.isRecording = false;

    if (this.processor) {
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
      this.processor = null;
    }

    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }

    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
  }

  isActive(): boolean {
    return this.isRecording;
  }
}
