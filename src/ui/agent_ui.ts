/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { LiveAgentManager, type AgentLogEntry } from '../agent/live_agent_manager.ts';
import { isWebMCPSupported } from '../adk-webmcp/index.ts';
import type { WebMCP } from 'webmcp-types';

export class AgentUI {
  private container: HTMLElement;
  private agentManager: LiveAgentManager;
  private logs: AgentLogEntry[] = [];
  private transcripts: Array<{ speaker: 'user' | 'model'; text: string }> = [];
  private registeredTools: WebMCP.RegisteredTool[] = [];
  private activeTab: 'chat' | 'tools' | 'logs' = 'chat';

  constructor(container: HTMLElement, agentManager: LiveAgentManager) {
    this.container = container;
    this.agentManager = agentManager;
  }

  async init() {
    this.render();
    await this.refreshTools();

    // Listen for WebMCP toolchange events to update tool inspector in real-time
    this.agentManager.getWebMCPToolset().listenForChanges(() => {
      this.refreshTools();
    });
  }

  async refreshTools() {
    if (isWebMCPSupported()) {
      try {
        this.registeredTools = await document.modelContext!.getTools();
        this.updateToolsTab();
      } catch (err) {
        console.error('Error fetching registered tools:', err);
      }
    }
  }

  addLog(entry: AgentLogEntry) {
    this.logs.unshift(entry);
    if (this.logs.length > 100) this.logs.pop();
    this.updateLogsTab();
  }

  updateTranscript(speaker: 'user' | 'model', text: string, isPartial: boolean = false) {
    const last = this.transcripts[this.transcripts.length - 1];
    if (!last || last.speaker !== speaker) {
      this.transcripts.push({ speaker, text });
    } else {
      if (isPartial) {
        last.text += text;
      } else {
        last.text = text;
      }
    }
    this.updateChatTab();
  }

  updateVolume(volumePercent: number) {
    const meterEl = this.container.querySelector('#mic-volume-meter') as HTMLElement;
    if (meterEl) {
      meterEl.style.width = `${Math.min(100, Math.max(0, volumePercent))}%`;
    }
  }

  updatePlaybackState(isPlaying: boolean) {
    const speakerIndicator = this.container.querySelector('#agent-speaker-indicator');
    if (speakerIndicator) {
      if (isPlaying) {
        speakerIndicator.classList.remove('hidden');
      } else {
        speakerIndicator.classList.add('hidden');
      }
    }
  }

  updateStatus(status: 'disconnected' | 'connecting' | 'connected' | 'error', message?: string) {
    const statusBadge = this.container.querySelector('#agent-status-badge');
    const connectBtn = this.container.querySelector('#btn-connect') as HTMLButtonElement;
    const micBtn = this.container.querySelector('#btn-mic') as HTMLButtonElement;

    if (statusBadge) {
      let badgeHtml = '';
      if (status === 'connected') {
        badgeHtml = `<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span><span class="text-emerald-400 font-semibold">Live Connected</span>`;
      } else if (status === 'connecting') {
        badgeHtml = `<span class="w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span><span class="text-cyan-400 font-semibold">Connecting...</span>`;
      } else if (status === 'error') {
        badgeHtml = `<span class="w-2 h-2 rounded-full bg-rose-500"></span><span class="text-rose-400 font-semibold">Error</span>`;
      } else {
        badgeHtml = `<span class="w-2 h-2 rounded-full bg-slate-500"></span><span class="text-slate-400">Offline</span>`;
      }
      statusBadge.innerHTML = badgeHtml;
    }

    if (connectBtn) {
      if (status === 'connected') {
        connectBtn.textContent = 'Disconnect';
        connectBtn.className =
          'px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 transition-all';
      } else {
        connectBtn.textContent = status === 'connecting' ? 'Connecting...' : 'Connect Live';
        connectBtn.className =
          'px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 shadow-md shadow-cyan-500/20 transition-all';
      }
      connectBtn.disabled = status === 'connecting';
    }

    if (micBtn) {
      micBtn.disabled = status !== 'connected';
      if (status !== 'connected') {
        micBtn.classList.add('opacity-50', 'cursor-not-allowed');
      } else {
        micBtn.classList.remove('opacity-50', 'cursor-not-allowed');
      }
    }

    if (message) {
      const msgEl = this.container.querySelector('#agent-status-message');
      if (msgEl) msgEl.textContent = message;
    }
  }

  render() {
    const savedApiKey = localStorage.getItem('gemini_api_key') || '';

    this.container.innerHTML = `
      <div class="h-full flex flex-col p-4 space-y-3.5 overflow-hidden">
        <!-- Live Connection Settings Header -->
        <div class="bg-slate-900/70 rounded-xl p-3 border border-slate-800 backdrop-blur-md">
          <div class="flex items-center justify-between pb-2 mb-2 border-b border-slate-800/80">
            <div class="flex items-center space-x-2" id="agent-status-badge">
              <span class="w-2 h-2 rounded-full bg-slate-500"></span>
              <span class="text-xs text-slate-400">Offline</span>
            </div>
            <div id="agent-status-message" class="text-[11px] text-slate-400 truncate max-w-[220px]">
              Ready to connect
            </div>
          </div>

          <div class="grid grid-cols-12 gap-2 items-center">
            <div class="col-span-5">
              <label class="text-[10px] text-slate-400 block mb-0.5">Gemini API Key</label>
              <input
                type="password"
                id="input-api-key"
                value="${savedApiKey}"
                placeholder="AIzaSy..."
                class="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs font-mono text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div class="col-span-4">
              <label class="text-[10px] text-slate-400 block mb-0.5">Live Model</label>
              <select
                id="select-model"
                class="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs font-mono text-slate-100 focus:outline-none focus:border-cyan-500"
              >
                <option value="gemini-3.8-flash-live" selected>gemini-3.8-flash-live (Default)</option>
                <option value="gemini-3.8-live">gemini-3.8-live</option>
                <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                <option value="gemini-2.0-flash-exp">gemini-2.0-flash-exp</option>
              </select>
            </div>
            <div class="col-span-3 flex items-end justify-end h-full pt-4">
              <button
                id="btn-connect"
                class="w-full px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 shadow-md shadow-cyan-500/20 transition-all"
              >
                Connect Live
              </button>
            </div>
          </div>
        </div>

        <!-- Voice & Audio Controller Bar -->
        <div class="bg-gradient-to-r from-slate-900/80 via-slate-900/60 to-slate-900/80 rounded-xl p-3 border border-slate-800 flex items-center justify-between space-x-3">
          <div class="flex items-center space-x-3">
            <button
              id="btn-mic"
              disabled
              class="w-11 h-11 rounded-xl bg-slate-800 text-slate-300 border border-slate-700 flex items-center justify-center transition-all duration-300 opacity-50 cursor-not-allowed hover:border-cyan-500"
              title="Click to toggle microphone"
            >
              <svg id="mic-icon" class="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </button>
            <div>
              <div class="text-xs font-bold text-slate-200 flex items-center gap-2">
                Voice Streaming
                <span id="mic-status-label" class="text-[10px] text-slate-400 font-normal">Mic Muted</span>
              </div>
              <div class="w-36 h-1.5 bg-slate-800 rounded-full mt-1.5 overflow-hidden">
                <div id="mic-volume-meter" class="h-full bg-cyan-400 transition-all duration-75 w-0"></div>
              </div>
            </div>
          </div>

          <div class="text-right flex items-center space-x-2">
            <span id="agent-speaker-indicator" class="hidden text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse flex items-center gap-1 font-semibold">
              🔊 Speaking
            </span>
            <div>
              <div class="text-[11px] font-medium text-slate-400">WebMCP Bridge</div>
              <div class="text-xs font-mono text-cyan-400">${this.registeredTools.length} tools registered</div>
            </div>
          </div>
        </div>

        <!-- Suggestion Chips -->
        <div class="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          <button class="suggestion-chip px-2.5 py-1 rounded-full bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/80 text-slate-300 whitespace-nowrap text-[11px] transition-colors">
            "Find flights to Tokyo"
          </button>
          <button class="suggestion-chip px-2.5 py-1 rounded-full bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/80 text-slate-300 whitespace-nowrap text-[11px] transition-colors">
            "Select flight SB-101"
          </button>
          <button class="suggestion-chip px-2.5 py-1 rounded-full bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/80 text-slate-300 whitespace-nowrap text-[11px] transition-colors">
            "Extra legroom seat + 2 bags"
          </button>
          <button class="suggestion-chip px-2.5 py-1 rounded-full bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/80 text-slate-300 whitespace-nowrap text-[11px] transition-colors">
            "Confirm booking for Scott"
          </button>
        </div>

        <!-- Navigation Tabs: Conversation | Registered Tools | Real-time Logs -->
        <div class="flex border-b border-slate-800 text-xs font-medium">
          <button id="tab-chat" class="tab-btn px-4 py-2 border-b-2 font-semibold ${this.activeTab === 'chat' ? 'border-cyan-400 text-cyan-400' : 'border-transparent text-slate-400 hover:text-slate-200'}">
            Conversation
          </button>
          <button id="tab-tools" class="tab-btn px-4 py-2 border-b-2 font-semibold ${this.activeTab === 'tools' ? 'border-cyan-400 text-cyan-400' : 'border-transparent text-slate-400 hover:text-slate-200'}">
            WebMCP Tools (${this.registeredTools.length})
          </button>
          <button id="tab-logs" class="tab-btn px-4 py-2 border-b-2 font-semibold ${this.activeTab === 'logs' ? 'border-cyan-400 text-cyan-400' : 'border-transparent text-slate-400 hover:text-slate-200'}">
            Trace Stream (${this.logs.length})
          </button>
        </div>

        <!-- Tab Contents -->
        <div class="flex-1 min-h-0 relative">
          <!-- Chat Tab -->
          <div id="content-chat" class="h-full flex flex-col ${this.activeTab === 'chat' ? '' : 'hidden'}">
            <div id="chat-messages" class="flex-1 overflow-y-auto space-y-3 p-1 pr-2">
              <div class="p-3 rounded-lg bg-slate-900/60 border border-slate-800 text-xs text-slate-300">
                <span class="font-bold text-cyan-400 block mb-1">🤖 In-Browser Agent Ready</span>
                Speak into the microphone or type below. As you talk, Gemini Live triggers native WebMCP tools on the left panel in real-time.
              </div>
            </div>

            <!-- Text Prompt Input -->
            <div class="pt-2">
              <form id="form-chat" class="flex items-center space-x-2">
                <input
                  type="text"
                  id="input-prompt"
                  placeholder="Ask agent or type flight command..."
                  class="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                />
                <button
                  type="submit"
                  class="px-3.5 py-2 rounded-lg bg-slate-800 text-cyan-400 hover:bg-slate-700 text-xs font-semibold border border-slate-700 transition-colors"
                >
                  Send
                </button>
              </form>
            </div>
          </div>

          <!-- Tools Tab -->
          <div id="content-tools" class="h-full overflow-y-auto space-y-2.5 p-1 ${this.activeTab === 'tools' ? '' : 'hidden'}">
            <!-- Populated dynamically -->
          </div>

          <!-- Logs Tab -->
          <div id="content-logs" class="h-full overflow-y-auto space-y-2 p-1 font-mono text-[11px] ${this.activeTab === 'logs' ? '' : 'hidden'}">
            <!-- Populated dynamically -->
          </div>
        </div>
      </div>
    `;

    this.attachEventListeners();
    this.updateChatTab();
    this.updateToolsTab();
    this.updateLogsTab();
  }

  private updateChatTab() {
    const messagesEl = this.container.querySelector('#chat-messages');
    if (!messagesEl) return;

    if (this.transcripts.length === 0) {
      messagesEl.innerHTML = `
        <div class="p-3 rounded-lg bg-slate-900/60 border border-slate-800 text-xs text-slate-300">
          <span class="font-bold text-cyan-400 block mb-1">🤖 In-Browser Agent Ready</span>
          Speak into the microphone or type below. As you talk, Gemini Live triggers native WebMCP tools on the left panel in real-time.
        </div>
      `;
      return;
    }

    messagesEl.innerHTML = this.transcripts
      .map((t) => {
        const isUser = t.speaker === 'user';
        return `
        <div class="flex flex-col ${isUser ? 'items-end' : 'items-start'}">
          <div class="text-[10px] text-slate-400 mb-0.5 px-1">${isUser ? 'You (Traveler)' : 'SkyBreeze Concierge'}</div>
          <div class="max-w-[85%] px-3.5 py-2 rounded-2xl text-xs leading-relaxed ${
            isUser
              ? 'bg-cyan-600 text-white rounded-tr-none'
              : 'bg-slate-800 text-slate-100 border border-slate-700 rounded-tl-none shadow-sm'
          }">
            ${t.text}
          </div>
        </div>
      `;
      })
      .join('');

    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  private updateToolsTab() {
    const toolsEl = this.container.querySelector('#content-tools');
    if (!toolsEl) return;

    if (this.registeredTools.length === 0) {
      toolsEl.innerHTML = `
        <div class="p-4 rounded-lg bg-slate-900/60 border border-slate-800 text-center text-xs text-slate-400">
          No WebMCP tools detected on document.modelContext.
        </div>
      `;
      return;
    }

    toolsEl.innerHTML = this.registeredTools
      .map((tool) => {
        const isConsequential = tool.annotations?.consequentialHint;
        const isReadOnly = tool.annotations?.readOnlyHint;

        return `
        <div class="p-3 rounded-lg bg-slate-900/60 border border-slate-800 hover:border-slate-700 transition-colors">
          <div class="flex items-center justify-between">
            <span class="font-mono text-xs font-bold text-cyan-400">${tool.name}</span>
            <div class="flex items-center space-x-1.5">
              ${
                isConsequential
                  ? `<span class="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">consequential</span>`
                  : ''
              }
              ${
                isReadOnly
                  ? `<span class="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">readOnly</span>`
                  : ''
              }
            </div>
          </div>
          <p class="text-[11px] text-slate-300 mt-1 leading-snug">${tool.description}</p>
          <div class="mt-2 bg-slate-950/80 p-2 rounded border border-slate-800 font-mono text-[10px] text-slate-400 overflow-x-auto">
            <pre>${JSON.stringify(tool.inputSchema, null, 2)}</pre>
          </div>
        </div>
      `;
      })
      .join('');
  }

  private updateLogsTab() {
    const logsEl = this.container.querySelector('#content-logs');
    if (!logsEl) return;

    if (this.logs.length === 0) {
      logsEl.innerHTML = `
        <div class="p-4 text-center text-xs text-slate-500">
          No events recorded yet. Connect and interact to see real-time ADK trace logs.
        </div>
      `;
      return;
    }

    logsEl.innerHTML = this.logs
      .map((log) => {
        let badgeColor = 'bg-slate-800 text-slate-400';
        if (log.type === 'tool_call') badgeColor = 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30';
        if (log.type === 'tool_response') badgeColor = 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
        if (log.type === 'error') badgeColor = 'bg-rose-500/20 text-rose-300 border border-rose-500/30';
        if (log.type === 'user') badgeColor = 'bg-blue-500/20 text-blue-300 border border-blue-500/30';

        const timeStr = log.timestamp.toTimeString().split(' ')[0];

        return `
        <div class="p-2 rounded bg-slate-900/70 border border-slate-800 space-y-1">
          <div class="flex items-center justify-between text-[10px]">
            <span class="px-1.5 py-0.5 rounded font-mono ${badgeColor}">${log.type.toUpperCase()}</span>
            <span class="text-slate-500">${timeStr}</span>
          </div>
          <div class="text-xs font-semibold text-slate-200">${log.title}</div>
          ${
            log.details
              ? `
            <div class="bg-slate-950 p-1.5 rounded text-[10px] text-slate-300 overflow-x-auto">
              <pre>${typeof log.details === 'string' ? log.details : JSON.stringify(log.details, null, 2)}</pre>
            </div>
          `
              : ''
          }
        </div>
      `;
      })
      .join('');
  }

  private attachEventListeners() {
    // API Key Input
    const apiKeyInput = this.container.querySelector('#input-api-key') as HTMLInputElement;
    apiKeyInput?.addEventListener('input', () => {
      localStorage.setItem('gemini_api_key', apiKeyInput.value.trim());
    });

    // Connect Button
    const connectBtn = this.container.querySelector('#btn-connect') as HTMLButtonElement;
    connectBtn?.addEventListener('click', async () => {
      if (this.agentManager.isLive()) {
        await this.agentManager.disconnect();
      } else {
        const key = apiKeyInput?.value.trim() || localStorage.getItem('gemini_api_key') || '';
        if (!key) {
          alert('Please enter your Gemini API key to start the Live session.');
          apiKeyInput?.focus();
          return;
        }

        const modelSelect = this.container.querySelector('#select-model') as HTMLSelectElement;
        const model = modelSelect?.value || 'gemini-3.8-flash-live';
        try {
          await this.agentManager.connect(key, model);
        } catch (err: any) {
          alert('Failed to connect: ' + (err?.message || String(err)));
        }
      }
    });

    // Mic Toggle Button
    const micBtn = this.container.querySelector('#btn-mic') as HTMLButtonElement;
    const micLabel = this.container.querySelector('#mic-status-label');

    const setMicUiState = (isActive: boolean) => {
      if (isActive) {
        micBtn.classList.add('bg-cyan-500', 'text-slate-950', 'mic-recording');
        micBtn.classList.remove('bg-slate-800', 'text-slate-300');
        if (micLabel) micLabel.textContent = 'Listening (Auto-VAD)...';
      } else {
        micBtn.classList.remove('bg-cyan-500', 'text-slate-950', 'mic-recording');
        micBtn.classList.add('bg-slate-800', 'text-slate-300');
        if (micLabel) micLabel.textContent = 'Mic Muted';
      }
    };

    micBtn?.addEventListener('click', async () => {
      if (!this.agentManager.isLive()) return;
      const isNowActive = await this.agentManager.toggleMicrophone();
      setMicUiState(isNowActive);
    });

    // Suggestion Chips
    this.container.querySelectorAll('.suggestion-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const text = chip.textContent?.replace(/"/g, '').trim();
        if (text) {
          const promptInput = this.container.querySelector('#input-prompt') as HTMLInputElement;
          if (promptInput) {
            promptInput.value = text;
            promptInput.focus();
          }
        }
      });
    });

    // Form submit
    const chatForm = this.container.querySelector('#form-chat') as HTMLFormElement;
    const promptInput = this.container.querySelector('#input-prompt') as HTMLInputElement;
    chatForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = promptInput?.value.trim();
      if (!text) return;

      if (!this.agentManager.isLive()) {
        alert('Please connect the Live agent first.');
        return;
      }

      promptInput.value = '';
      try {
        await this.agentManager.sendTextMessage(text);
      } catch (err: any) {
        alert('Failed to send: ' + (err?.message || String(err)));
      }
    });

    // Tabs
    const tabChat = this.container.querySelector('#tab-chat');
    const tabTools = this.container.querySelector('#tab-tools');
    const tabLogs = this.container.querySelector('#tab-logs');

    tabChat?.addEventListener('click', () => {
      this.activeTab = 'chat';
      this.render();
    });
    tabTools?.addEventListener('click', () => {
      this.activeTab = 'tools';
      this.render();
    });
    tabLogs?.addEventListener('click', () => {
      this.activeTab = 'logs';
      this.render();
    });
  }
}
