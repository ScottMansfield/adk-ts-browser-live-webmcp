/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseTool, type RunAsyncToolRequest } from '@google/adk';
import { Type, type FunctionDeclaration, type Schema } from '@google/genai';
import { toGeminiSchema } from './schema_utils.ts';
import type { WebMCP } from 'webmcp-types';

/**
 * How this browser wants `executeTool` arguments.
 *
 * Chrome took a JSON *string* originally and switched to a plain object, with
 * the string form deprecated from Chrome 155. Passing an object to an older
 * build makes it parse "[object Object]" and fail, so the encoding is probed
 * once and then reused for the rest of the session.
 */
type ArgEncoding = 'object' | 'json-string';
let negotiatedArgEncoding: ArgEncoding | null = null;

/** Resets the probe; intended for tests. */
export function resetWebMCPArgEncoding() {
  negotiatedArgEncoding = null;
}

/** True when a result/exception means the browser could not read the args. */
function isArgParseFailure(value: unknown): boolean {
  const text =
    typeof value === 'string'
      ? value
      : value && typeof value === 'object'
        ? String((value as any).error ?? (value as any).message ?? '')
        : '';
  return /failed to parse input arguments|could not parse .*arguments/i.test(text);
}

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

  /**
   * Returns the tool's JSON Schema as an object.
   *
   * `RegisteredTool.inputSchema` is typed `object`, but this API is
   * experimental and its runtime has already been shown to diverge from the
   * type elsewhere (`executeTool` arguments). A schema that arrives as a JSON
   * string would otherwise convert to a parameterless declaration, and the
   * model would then call the tool with no arguments at all.
   */
  private resolveInputSchema(): Record<string, any> | undefined {
    const raw = this.webmcpTool.inputSchema as unknown;
    if (raw == null) return undefined;
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
      } catch {
        console.warn(
          `[webmcp] tool '${this.webmcpTool.name}' has an inputSchema string that is not valid JSON; ` +
            'it will be exposed with no parameters.'
        );
        return undefined;
      }
    }
    if (typeof raw === 'object') return raw as Record<string, any>;
    return undefined;
  }

  override _getDeclaration(): FunctionDeclaration | undefined {
    const schema = this.resolveInputSchema();
    // An explicit empty object beats TYPE_UNSPECIFIED: it tells the model the
    // tool genuinely takes no arguments, rather than leaving the shape unknown.
    const parameters = schema
      ? toGeminiSchema(schema)
      : ({ type: Type.OBJECT, properties: {} } as Schema);

    if (schema && !(parameters as any)?.properties) {
      console.warn(
        `[webmcp] tool '${this.webmcpTool.name}' declared an inputSchema but it produced no ` +
          'parameters; the model will be unable to pass arguments.',
        schema
      );
    }

    return {
      name: this.name,
      description: this.webmcpTool.description || '',
      parameters,
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
    const args = request.args ?? {};
    const options = abortSignal ? { signal: abortSignal } : undefined;

    const invoke = (encoding: ArgEncoding) =>
      executeToolFn.call(
        modelContext,
        this.webmcpTool,
        encoding === 'json-string' ? JSON.stringify(args) : args,
        options
      );

    // Once the encoding is known, use it directly.
    if (negotiatedArgEncoding) {
      return await invoke(negotiatedArgEncoding);
    }

    // Probe: try the modern object form, fall back to the legacy JSON string.
    // A parse failure means the tool never ran, so retrying cannot double-apply
    // a side effect.
    let firstResult: unknown;
    try {
      firstResult = await invoke('object');
      if (!isArgParseFailure(firstResult)) {
        negotiatedArgEncoding = 'object';
        return firstResult;
      }
    } catch (err) {
      if (!isArgParseFailure(err)) throw err;
      firstResult = err;
    }

    const retried = await invoke('json-string');
    if (isArgParseFailure(retried)) {
      // Neither encoding worked; surface the original complaint.
      return firstResult;
    }
    negotiatedArgEncoding = 'json-string';
    console.info(
      '[webmcp] this browser expects JSON-string tool arguments; using that encoding'
    );
    return retried;
  }
}
