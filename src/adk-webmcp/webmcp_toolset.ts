/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseToolset, type BaseTool, type ToolPredicate, type ReadonlyContext } from '@google/adk';
import { WebMCPTool } from './webmcp_tool.ts';
import type { WebMCP } from 'webmcp-types';

export interface WebMCPToolsetOptions {
  /**
   * Filter which tools to expose to the LLM agent.
   * Can be an array of tool names or a predicate function.
   */
  toolFilter?: ToolPredicate | string[];

  /**
   * Optional prefix to prepend to tool names (e.g. `web_`).
   */
  prefix?: string;

  /**
   * Optional array of secure origins to query tools from (for cross-origin iframes).
   */
  fromOrigins?: string[];

  /**
   * Custom Document reference (defaults to global window.document).
   */
  document?: Document;
}

/**
 * Returns true if the native WebMCP API is present in the current browser document.
 */
export function isWebMCPSupported(doc: Document = globalThis.document): boolean {
  return typeof doc !== 'undefined' && doc !== null && 'modelContext' in doc && !!doc.modelContext;
}

/**
 * ADK Toolset for Chrome WebMCP (Model Context Protocol).
 * Exposes in-browser tools registered via document.modelContext to ADK agents.
 */
export class WebMCPToolset extends BaseToolset {
  private readonly doc: Document;
  private readonly fromOrigins?: string[];
  private changeListeners: Array<() => void> = [];

  constructor(options: WebMCPToolsetOptions = {}) {
    super(options.toolFilter ?? [], options.prefix);
    this.doc = options.document ?? (typeof document !== 'undefined' ? document : (undefined as unknown as Document));
    this.fromOrigins = options.fromOrigins;
  }

  /**
   * Checks if native WebMCP is available on the current document.
   */
  isSupported(): boolean {
    return isWebMCPSupported(this.doc);
  }

  /**
   * Retrieves all tools exposed via document.modelContext, converting them
   * to ADK WebMCPTool instances.
   */
  override async getTools(context?: ReadonlyContext): Promise<BaseTool[]> {
    if (!this.isSupported()) {
      console.warn(
        'WebMCPToolset: document.modelContext is not supported in this browser. Ensure chrome://flags/#enable-webmcp-testing is enabled.'
      );
      return [];
    }

    const modelContext = this.doc.modelContext!;
    const getToolsOptions = this.fromOrigins ? { fromOrigins: this.fromOrigins } : undefined;
    const registeredTools: WebMCP.RegisteredTool[] = await modelContext.getTools(getToolsOptions);

    const tools: BaseTool[] = [];
    for (const rawTool of registeredTools) {
      const toolName = this.prefix ? `${this.prefix}_${rawTool.name}` : rawTool.name;
      const tool = new WebMCPTool(rawTool, toolName, this.doc);
      tools.push(tool);
    }

    const filter = this.toolFilter;
    if (!filter || (Array.isArray(filter) && filter.length === 0)) {
      return tools;
    }
    if (Array.isArray(filter)) {
      return tools.filter((tool) => filter.includes(tool.name));
    }
    if (context) {
      return tools.filter((tool) => (filter as ToolPredicate)(tool, context));
    }

    return tools;
  }

  /**
   * Subscribes to the WebMCP `toolchange` event on document.modelContext.
   * Returns an unsubscribe function.
   */
  listenForChanges(onChange: () => void): () => void {
    if (!this.isSupported()) {
      return () => {};
    }

    const modelContext = this.doc.modelContext!;
    const handler = () => onChange();
    this.changeListeners.push(handler);

    modelContext.addEventListener('toolchange', handler);
    return () => {
      modelContext.removeEventListener('toolchange', handler);
      this.changeListeners = this.changeListeners.filter((l) => l !== handler);
    };
  }

  /**
   * Closes the toolset and cleans up active subscriptions.
   */
  override async close(): Promise<void> {
    if (this.isSupported() && this.changeListeners.length > 0) {
      const modelContext = this.doc.modelContext!;
      for (const listener of this.changeListeners) {
        modelContext.removeEventListener('toolchange', listener);
      }
      this.changeListeners = [];
    }
  }
}
