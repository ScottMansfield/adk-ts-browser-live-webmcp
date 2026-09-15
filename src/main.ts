/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { TravelApp } from './app/travel_app.ts';
import { LiveAgentManager } from './agent/live_agent_manager.ts';
import { AgentUI } from './ui/agent_ui.ts';
import { isWebMCPSupported } from './adk-webmcp/index.ts';

async function bootstrap() {
  const travelContainer = document.getElementById('travel-app-container');
  const agentContainer = document.getElementById('adk-agent-panel');
  const topStatus = document.getElementById('top-webmcp-status');

  if (!travelContainer || !agentContainer) {
    throw new Error('Required DOM containers not found.');
  }

  // 1. WebMCP Status indicator in header
  const hasWebMCP = isWebMCPSupported();
  if (topStatus) {
    topStatus.innerHTML = hasWebMCP
      ? `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
          WebMCP: Enabled
        </span>`
      : `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">
          <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
          WebMCP: Flag Needed (#enable-webmcp-testing)
        </span>`;
  }

  // 2. Initialize Travel Web Application
  const travelApp = new TravelApp(travelContainer);
  await travelApp.initWebMCPTools();

  // 3. Initialize In-Browser Live Agent
  let agentUI: AgentUI;
  const agentManager = new LiveAgentManager({
    onStatusChange: (status, message) => {
      agentUI?.updateStatus(status, message);
    },
    onLog: (entry) => {
      agentUI?.addLog(entry);
    },
    onTranscript: (speaker, text, isPartial) => {
      agentUI?.updateTranscript(speaker, text, isPartial);
    },
    onVolumeChange: (volume) => {
      agentUI?.updateVolume(volume);
    },
    onPlaybackStateChange: (isPlaying) => {
      agentUI?.updatePlaybackState(isPlaying);
    },
  });

  agentUI = new AgentUI(agentContainer, agentManager);
  await agentUI.init();

  // 4. Connect WebMCP tool execution callbacks to agent UI
  travelApp.setToolActivityCallback((toolName, args, result) => {
    agentUI.addLog({
      id: crypto.randomUUID(),
      timestamp: new Date(),
      type: 'tool_call',
      title: `⚡ WebMCP Tool Executed: ${toolName}`,
      details: { arguments: args, returned: result },
    });
  });
}

bootstrap().catch((err) => {
  console.error('Fatal initialization error:', err);
});
