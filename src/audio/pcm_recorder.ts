/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { arrayBufferToBase64, float32ToInt16PCM } from './audio_utils.ts';
import { PCM_WORKLET_PROCESSOR_CODE } from './pcm_worklet.ts';

export interface RecorderCallbacks {
  onAudioChunk: (base64Data: string) => void;
  onVolumeChange?: (volumePercent: number) => void;
}

export class PCMRecorder {
  private mediaStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private legacyProcessor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private isRecording: boolean = false;
  private readonly targetSampleRate = 16000;
  private workletUrl: string | null = null;

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
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    const sourceSampleRate = this.audioCtx.sampleRate;
    this.source = this.audioCtx.createMediaStreamSource(this.mediaStream);

    const handleAudioSamples = (inputData: Float32Array) => {
      if (!this.isRecording) return;

      // Calculate RMS for volume visualization
      let sumSquares = 0;
      for (let i = 0; i < inputData.length; i++) {
        sumSquares += inputData[i] * inputData[i];
      }
      const rms = Math.sqrt(sumSquares / inputData.length);
      const volume = Math.min(100, Math.round(rms * 400));
      callbacks.onVolumeChange?.(volume);

      // Downsample to 16kHz linear PCM if needed
      const resampledData = this.resampleAudio(inputData, sourceSampleRate, this.targetSampleRate);
      const pcm16 = float32ToInt16PCM(resampledData);
      const base64Chunk = arrayBufferToBase64(pcm16.buffer);

      callbacks.onAudioChunk(base64Chunk);
    };

    // Modern AudioWorkletNode implementation
    if ('audioWorklet' in this.audioCtx) {
      try {
        const blob = new Blob([PCM_WORKLET_PROCESSOR_CODE], { type: 'application/javascript' });
        this.workletUrl = URL.createObjectURL(blob);
        await this.audioCtx.audioWorklet.addModule(this.workletUrl);

        this.workletNode = new AudioWorkletNode(this.audioCtx, 'pcm-recorder-processor');
        this.workletNode.port.onmessage = (event) => {
          handleAudioSamples(event.data);
        };

        this.source.connect(this.workletNode);
        this.isRecording = true;
        return;
      } catch (err) {
        console.warn('AudioWorklet initialization failed, using fallback:', err);
      }
    }

    // Fallback if AudioWorklet fails
    this.legacyProcessor = this.audioCtx.createScriptProcessor(2048, 1, 1);
    this.legacyProcessor.onaudioprocess = (e) => {
      handleAudioSamples(e.inputBuffer.getChannelData(0));
    };
    this.source.connect(this.legacyProcessor);
    this.legacyProcessor.connect(this.audioCtx.destination);
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

    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode.port.onmessage = null;
      this.workletNode = null;
    }

    if (this.legacyProcessor) {
      this.legacyProcessor.disconnect();
      this.legacyProcessor.onaudioprocess = null;
      this.legacyProcessor = null;
    }

    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }

    if (this.workletUrl) {
      URL.revokeObjectURL(this.workletUrl);
      this.workletUrl = null;
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
