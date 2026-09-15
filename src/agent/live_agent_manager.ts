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
import { WebMCPToolset } from '../adk-webmcp/index.ts';
import { PCMPlayer } from '../audio/pcm_player.ts';
import { PCMRecorder } from '../audio/pcm_recorder.ts';

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

  constructor(callbacks: LiveAgentCallbacks) {
    this.callbacks = callbacks;
    this.webmcpToolset = new WebMCPToolset();
    this.pcmPlayer = new PCMPlayer(24000);
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

  async connect(apiKey: string, modelName: string = 'gemini-3.8-flash-live') {
    if (this.isConnected) {
      await this.disconnect();
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
1. 'search_flights': Search for flights matching the user's destination, origin, and cabin class.
2. 'select_flight': Select a flight card on the page using its flightId (e.g. SB-101, SB-102).
3. 'customize_amenities': Change seating preference (Window, Aisle, Extra Legroom Exit Row), in-flight meal, and checked luggage count.
4. 'confirm_booking': Finalize the reservation when the traveler provides their name and email.
5. 'get_current_itinerary': Inspect the current state of the travel itinerary.

Behavior guidelines:
- Actuate the webpage immediately when the user gives instructions.
- Be friendly, concise, natural, and helpful.
- When you execute a tool, acknowledge the action cleanly (e.g., "I've pulled up flights to Tokyo. Flight SB 101 on the Dreamliner leaves at 11:15 AM.").`,
        tools: [this.webmcpToolset],
      });

      this.runner = new Runner({
        agent: this.agent,
        appName: 'SkyBreezeDemo',
        sessionService: new InMemorySessionService(),
      });

      this.liveRequestQueue = new LiveRequestQueue();
      this.abortController = new AbortController();
      this.isConnected = true;

      this.callbacks.onStatusChange('connected', `Live session active (${modelName})`);
      this.callbacks.onLog({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        type: 'system',
        title: 'Live Agent Connected',
        details: { model: modelName },
      });

      // Start the ADK live event processing loop in background
      this.startLiveLoop();
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

  private async startLiveLoop() {
    if (!this.runner || !this.liveRequestQueue || !this.abortController) return;

    try {
      const liveEvents = this.runner.runLive({
        sessionId: 'browser-live-session',
        userId: 'demo-user',
        liveRequestQueue: this.liveRequestQueue,
        abortSignal: this.abortController.signal,
      });

      for await (const event of liveEvents) {
        this.processLiveEvent(event);
      }
    } catch (err: any) {
      if (this.abortController?.signal.aborted) {
        return;
      }
      console.error('Error in live runner loop:', err);
      this.callbacks.onLog({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        type: 'error',
        title: 'Live Session Interrupted',
        details: err?.message || String(err),
      });
      this.callbacks.onStatusChange('error', err?.message || String(err));
      this.disconnect();
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
      this.callbacks.onTranscript('model', text, (event as any).partial);
    }

    // 3. Audio output
    if (event.content?.parts) {
      for (const part of event.content.parts) {
        if (part.inlineData?.mimeType?.startsWith('audio/') && part.inlineData.data) {
          this.pcmPlayer.playChunk(part.inlineData.data);
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

    this.liveRequestQueue.sendActivityStart();
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
      title: 'Microphone Streaming Started (16kHz PCM)',
    });
  }

  stopMicrophone() {
    this.pcmRecorder.stop();
    this.callbacks.onVolumeChange(0);
    if (this.liveRequestQueue && this.isConnected) {
      this.liveRequestQueue.sendActivityEnd();
    }
    this.callbacks.onLog({
      id: crypto.randomUUID(),
      timestamp: new Date(),
      type: 'system',
      title: 'Microphone Streaming Stopped',
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
