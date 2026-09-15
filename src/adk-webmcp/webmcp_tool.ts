/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseTool, type RunAsyncToolRequest } from '@google/adk';
import type { FunctionDeclaration } from '@google/genai';
import { toGeminiSchema } from './schema_utils.ts';
import type { WebMCP } from 'webmcp-types';

export class WebMCPTool extends BaseTool {
  readonly webmcpTool: WebMCP.RegisteredTool;
  readonly originalName: string;
  private readonly doc: Document;

  constructor(
    webmcpTool: WebMCP.RegisteredTool,
    name?: string,
    doc?: Document
  ) {
    super({
      name: name || webmcpTool.name,
      description: webmcpTool.description || '',
    });
    this.webmcpTool = webmcpTool;
    this.originalName = webmcpTool.name;
    this.doc = doc ?? (typeof document !== 'undefined' ? document : (undefined as unknown as Document));
  }

  override _getDeclaration(): FunctionDeclaration | undefined {
    return {
      name: this.name,
      description: this.webmcpTool.description || '',
      parameters: toGeminiSchema(this.webmcpTool.inputSchema),
    };
  }

  override async checkRequireConfirmation(
    _args: Record<string, any>,
    _toolContext?: any
  ): Promise<boolean> {
    return !!this.webmcpTool.annotations?.consequentialHint;
  }

  override async runAsync(request: RunAsyncToolRequest): Promise<any> {
    const modelContext = this.doc?.modelContext;
    if (!modelContext) {
      throw new Error(
        'document.modelContext is not available. Please verify WebMCP is enabled in Chrome via chrome://flags/#enable-webmcp-testing'
      );
    }

    // Call native document.modelContext.executeTool with the registered tool descriptor
    const executeToolFn = (modelContext as any).executeTool;
    if (typeof executeToolFn !== 'function') {
      throw new Error(
        'document.modelContext.executeTool is not a function. Check your browser WebMCP implementation.'
      );
    }

    const abortSignal = request.toolContext?.abortSignal;
    const result = await executeToolFn.call(
      modelContext,
      this.webmcpTool,
      request.args ?? {},
      abortSignal ? { signal: abortSignal } : undefined
    );

    return result;
  }
}
