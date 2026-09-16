/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Gemini,
  LlmAgent,
  Runner,
  LiveRequestQueue,
  InMemorySessionService,
  getFunctionCalls,
  getFunctionResponses,
  type Event as ADKEvent,
} from '@google/adk';
import { Modality } from '@google/genai';
import { WebMCPToolset } from '../adk-webmcp/index.ts';
import { PCMPlayer } from '../audio/pcm_player.ts';
import { PCMRecorder } from '../audio/pcm_recorder.ts';
import {
  describeCloseCode,
  installLiveSocketMonitor,
  onLiveSocketEvent,
} from './live_socket_monitor.ts';

installLiveSocketMonitor();

/**
 * Counts audio frames actually handed to the socket, so "no voice response"
 * can be told apart from "no audio was ever sent".
 */
export const audioTelemetry = { framesSent: 0 };

/**
 * ADK picks the realtime audio field via `isGemini3xFlashLive()`, which matches
 * `gemini-3.*` AND `-flash-live`. Ids like `gemini-3.8-live` miss that test and
 * fall back to the legacy `{ media }` (`mediaChunks`) field. `{ audio }` is the
 * current field for audio blobs and is what 3.x expects, so route audio there.
 */
const originalGeminiConnect = (Gemini.prototype as any).connect;
if (originalGeminiConnect && !(Gemini.prototype as any).__patchedForLiveAudio) {
  (Gemini.prototype as any).__patchedForLiveAudio = true;
  (Gemini.prototype as any).connect = async function (llmRequest: any) {
    const connection = await originalGeminiConnect.call(this, llmRequest);
    const originalSendRealtime = connection.sendRealtime;

    connection.sendRealtime = async function (blob: any) {
      if (blob?.mimeType?.startsWith('audio/')) {
        audioTelemetry.framesSent++;
        if (audioTelemetry.framesSent === 1) {
          console.log('[live] first audio frame sent as realtimeInput.audio', blob.mimeType);
        }
        this.geminiSession.sendRealtimeInput({ audio: blob });
        return;
      }
      return originalSendRealtime.call(this, blob);
    };

    return connection;
  };
}

/**
 * Starting point for the model dropdown. Live model IDs churn, so this is only
 * a seed - use "load from API" in the UI to list what the key can actually use.
 */
export const DEFAULT_LIVE_MODEL = 'gemini-3.8-live';

export interface AgentLogEntry {
  id: string;
  timestamp: Date;
  type: 'system' | 'user' | 'model' | 'tool_call' | 'tool_response' | 'error';
  title: string;
  details?: any;
}

export interface LiveAgentCallbacks {
  onStatusChange: (status: 'disconnected' | 'connecting' | 'connected' | 'error', message?: string) => void;
  onLog: (entry: AgentLogEntry) => void;
  onTranscript: (speaker: 'user' | 'model', text: string, isPartial?: boolean) => void;
  onVolumeChange: (volumePercent: number) => void;
  onPlaybackStateChange?: (isPlaying: boolean) => void;
}

export class LiveAgentManager {
  private gemini: Gemini | null = null;
  private agent: LlmAgent | null = null;
  private runner: Runner | null = null;
  private liveRequestQueue: LiveRequestQueue | null = null;
  private abortController: AbortController | null = null;
  private isConnected: boolean = false;

  private webmcpToolset: WebMCPToolset;
  private pcmPlayer: PCMPlayer;
  private pcmRecorder: PCMRecorder;
  private callbacks: LiveAgentCallbacks;
  private unsubscribeSocket: (() => void) | null = null;
  private sawModelEvent = false;
  private usesOutputTranscription = false;

  constructor(callbacks: LiveAgentCallbacks) {
    this.callbacks = callbacks;
    this.webmcpToolset = new WebMCPToolset();
    this.pcmPlayer = new PCMPlayer(24000);
    this.pcmPlayer.setPlaybackStateCallback((isPlaying) => {
      this.callbacks.onPlaybackStateChange?.(isPlaying);
    });
    this.pcmRecorder = new PCMRecorder();
  }

  isLive(): boolean {
    return this.isConnected;
  }

  isMicActive(): boolean {
    return this.pcmRecorder.isActive();
  }

  getWebMCPToolset(): WebMCPToolset {
    return this.webmcpToolset;
  }

  async connect(apiKey: string, modelName: string = 'gemini-3.8-live') {
    if (this.isConnected) {
      await this.disconnect();
    }

    // Unlock Web Audio playback within user gesture context
    try {
      await this.pcmPlayer.resume();
    } catch (e) {
      console.warn('AudioContext pre-warming warning:', e);
    }

    this.callbacks.onStatusChange('connecting', `Opening Live connection to ${modelName}...`);

    try {
      this.gemini = new Gemini({
        model: modelName,
        apiKey: apiKey,
      });

      this.agent = new LlmAgent({
        name: 'SkyBreezeConcierge',
        model: this.gemini,
        instruction: `You are the proactive voice concierge for SkyBreeze Airways.
You assist travelers directly inside their browser via the Web Model Context Protocol (WebMCP).
You have access to native browser tools registered on the page:
1. 'search_flights': Search for flights matching destination, origin, and cabin class.
   - If the user names a destination without an origin, assume origin is 'SFO' (San Francisco) and search immediately.
2. 'select_flight': Select a flight card on the page using its flightId (e.g. SB-101, SB-102).
3. 'customize_amenities': Change seating preference (Window, Aisle, Extra Legroom Exit Row), in-flight meal, and checked luggage count.
4. 'confirm_booking': Finalize the reservation when the traveler provides their name and email.
5. 'get_current_itinerary': Inspect the current state of the travel itinerary.

Behavior guidelines:
- Actuate the webpage immediately by calling the tools when the user gives instructions.
- Never ask redundant questions if the destination or flight is clear. Default origin to SFO.
- When you execute a tool, describe what changed cleanly, concisely, and naturally.`,
        tools: [this.webmcpToolset],
      });

      this.runner = new Runner({
        agent: this.agent,
        appName: 'SkyBreezeDemo',
        sessionService: new InMemorySessionService(),
      });

      this.liveRequestQueue = new LiveRequestQueue();
      this.abortController = new AbortController();

      // Watch the real socket: a rejected upgrade otherwise leaves the SDK's
      // connect() pending forever with no error anywhere.
      this.sawModelEvent = false;
      this.unsubscribeSocket?.();
      this.unsubscribeSocket = onLiveSocketEvent((event) => {
        if (event.type === 'open') {
          this.callbacks.onLog({
            id: crypto.randomUUID(),
            timestamp: new Date(),
            type: 'system',
            title: 'Live WebSocket open',
            details: { model: modelName },
          });
          return;
        }
        if (event.type === 'toolcall') {
          this.callbacks.onLog({
            id: crypto.randomUUID(),
            timestamp: new Date(),
            type: 'tool_call',
            title: 'Raw toolCall frame from server',
            details: event.functionCalls,
          });
          return;
        }
        if (event.type === 'close') {
          const explanation = describeCloseCode(event.code, event.reason);
          // Once the socket is gone nothing can be sent, so never leave the UI
          // claiming the session is live.
          const wasUsable = this.sawModelEvent;
          this.isConnected = false;
          this.callbacks.onLog({
            id: crypto.randomUUID(),
            timestamp: new Date(),
            type: 'error',
            title: wasUsable
              ? 'Live connection closed'
              : `Live connection failed (model: ${modelName})`,
            details: explanation,
          });
          this.callbacks.onStatusChange('error', explanation);
        }
      });

      // Mark connected as soon as the queue exists. runLive() only yields its
      // first event AFTER the model replies, and the model cannot reply until
      // we send it input - so gating sendTextMessage()/startMicrophone() on
      // "first event received" deadlocks the session permanently.
      this.isConnected = true;
      this.callbacks.onStatusChange('connected', `Live session active (${modelName})`);

      this.callbacks.onLog({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        type: 'system',
        title: 'Live session ready',
        details: { model: modelName },
      });

      // Start the ADK live event processing loop
      this.startLiveLoop(modelName);

      // Open the mic straight away: this runs inside the Connect click, which
      // is the user gesture getUserMedia and AudioContext both require.
      try {
        await this.startMicrophone();
      } catch (micErr: any) {
        this.callbacks.onLog({
          id: crypto.randomUUID(),
          timestamp: new Date(),
          type: 'error',
          title: 'Microphone unavailable - use the mic button or type instead',
          details: micErr?.message || String(micErr),
        });
      }
    } catch (err: any) {
      this.isConnected = false;
      this.callbacks.onStatusChange('error', err?.message || String(err));
      this.callbacks.onLog({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        type: 'error',
        title: 'Connection Failed',
        details: err?.message || String(err),
      });
      throw err;
    }
  }

  private async startLiveLoop(modelName: string) {
    if (!this.runner || !this.liveRequestQueue || !this.abortController) return;

    try {
      const liveEvents = this.runner.runLive({
        sessionId: 'browser-live-session',
        userId: 'demo-user',
        liveRequestQueue: this.liveRequestQueue,
        abortSignal: this.abortController.signal,
        runConfig: {
          responseModalities: [Modality.AUDIO],
          outputAudioTranscription: {},
          inputAudioTranscription: {},
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: 'Aoede',
              },
            },
          },
        },
      });

      let sawFirstEvent = false;

      for await (const event of liveEvents) {
        if (!sawFirstEvent) {
          sawFirstEvent = true;
          this.sawModelEvent = true;
          this.callbacks.onLog({
            id: crypto.randomUUID(),
            timestamp: new Date(),
            type: 'system',
            title: 'First response received from model',
            details: { model: modelName, audioSampleRate: 24000 },
          });
        }

        this.processLiveEvent(event);
      }
    } catch (err: any) {
      if (this.abortController?.signal.aborted) {
        return;
      }
      console.error('Error in live runner loop:', err);
      const errMsg = err?.message || String(err);
      this.isConnected = false;
      this.callbacks.onStatusChange('error', errMsg);
      this.callbacks.onLog({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        type: 'error',
        title: 'Live Session Error',
        details: errMsg,
      });
      this.pcmRecorder.stop();
      this.pcmPlayer.stop();
    }
  }

  private processLiveEvent(event: ADKEvent) {
    // 1. Check for interruptions
    if ((event as any).interrupted) {
      this.pcmPlayer.stop();
      this.callbacks.onLog({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        type: 'system',
        title: 'Agent Speech Interrupted by User',
      });
    }

    // 2. Transcriptions
    if ((event as any).inputTranscription?.text) {
      const text = (event as any).inputTranscription.text;
      this.callbacks.onTranscript('user', text, (event as any).partial);
    }
    if ((event as any).outputTranscription?.text) {
      const text = (event as any).outputTranscription.text;
      this.usesOutputTranscription = true;
      this.callbacks.onTranscript('model', text, (event as any).partial);
    }

    // 3. Audio & Text content
    if (event.content?.parts) {
      for (const part of event.content.parts) {
        // Audio output (24kHz PCM)
        if (part.inlineData?.data) {
          const mimeType = part.inlineData.mimeType || 'audio/pcm;rate=24000';
          let sampleRate = 24000;
          const match = mimeType.match(/rate=(\d+)/);
          if (match) {
            sampleRate = parseInt(match[1], 10);
          }
          this.pcmPlayer.playChunk(part.inlineData.data, sampleRate);
        }

        // Text parts restate what the transcription stream already delivered,
        // so once transcription is in play it is the single source of truth.
        if (part.text && !part.thought && !this.usesOutputTranscription) {
          this.callbacks.onTranscript('model', part.text, (event as any).partial);
        }
      }
    }

    // 4. Function Calls
    const functionCalls = getFunctionCalls(event);
    if (functionCalls.length > 0) {
      for (const fc of functionCalls) {
        this.callbacks.onLog({
          id: crypto.randomUUID(),
          timestamp: new Date(),
          type: 'tool_call',
          title: `WebMCP Tool Call: ${fc.name}`,
          details: fc.args,
        });
      }
    }

    // 5. Function Responses
    const functionResponses = getFunctionResponses(event);
    if (functionResponses.length > 0) {
      for (const fr of functionResponses) {
        this.callbacks.onLog({
          id: crypto.randomUUID(),
          timestamp: new Date(),
          type: 'tool_response',
          title: `WebMCP Tool Result: ${fr.name}`,
          details: fr.response,
        });
      }
    }
  }

  async sendTextMessage(text: string) {
    if (!this.liveRequestQueue || !this.isConnected) {
      throw new Error('Live agent is not connected.');
    }

    // Unlock audio context on user interaction
    try {
      await this.pcmPlayer.resume();
    } catch (_e) {}

    this.callbacks.onTranscript('user', text, false);
    this.callbacks.onLog({
      id: crypto.randomUUID(),
      timestamp: new Date(),
      type: 'user',
      title: 'User Prompt',
      details: text,
    });

    this.liveRequestQueue.sendContent({
      role: 'user',
      parts: [{ text }],
    });
  }

  async startMicrophone() {
    if (!this.liveRequestQueue || !this.isConnected) {
      throw new Error('Live agent is not connected.');
    }

    // Unlock audio playback within user gesture
    await this.pcmPlayer.resume();

    await this.pcmRecorder.start({
      onAudioChunk: (base64Chunk) => {
        if (this.liveRequestQueue && this.isConnected) {
          this.liveRequestQueue.sendRealtime({
            mimeType: 'audio/pcm;rate=16000',
            data: base64Chunk,
          });
        }
      },
      onVolumeChange: (vol) => {
        this.callbacks.onVolumeChange(vol);
      },
    });

    this.callbacks.onLog({
      id: crypto.randomUUID(),
      timestamp: new Date(),
      type: 'system',
      title: 'Microphone Active (Streaming 16kHz PCM, automatic VAD active)',
    });
  }

  stopMicrophone() {
    this.pcmRecorder.stop();
    this.callbacks.onVolumeChange(0);

    this.callbacks.onLog({
      id: crypto.randomUUID(),
      timestamp: new Date(),
      type: 'system',
      title: 'Microphone Muted',
    });
  }

  async toggleMicrophone(): Promise<boolean> {
    if (this.isMicActive()) {
      this.stopMicrophone();
      return false;
    } else {
      await this.startMicrophone();
      return true;
    }
  }

  async disconnect() {
    this.stopMicrophone();
    this.pcmPlayer.stop();
    this.unsubscribeSocket?.();
    this.unsubscribeSocket = null;

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.liveRequestQueue) {
      this.liveRequestQueue.close();
      this.liveRequestQueue = null;
    }

    this.isConnected = false;
    this.callbacks.onStatusChange('disconnected', 'Live connection closed');
    this.callbacks.onLog({
      id: crypto.randomUUID(),
      timestamp: new Date(),
      type: 'system',
      title: 'Live Agent Disconnected',
    });
  }
}
