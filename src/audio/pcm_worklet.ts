/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const PCM_WORKLET_PROCESSOR_CODE = `
class PCMRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Buffer 512 samples (~32ms at 16kHz) for optimal Live API VAD chunking
    this.bufferSize = 512;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channel = input[0];
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.bufferIndex++] = channel[i];
        if (this.bufferIndex >= this.bufferSize) {
          // Post exactly 512 samples
          this.port.postMessage(this.buffer.slice(0, this.bufferSize));
          this.bufferIndex = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-recorder-processor', PCMRecorderProcessor);
`;
