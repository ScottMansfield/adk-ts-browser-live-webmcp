/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type, type Schema } from '@google/genai';

/**
 * Converts a WebMCP / JSON schema to a Gemini API Schema object.
 */
function toGeminiType(mcpType?: string): Type {
  if (!mcpType) return Type.TYPE_UNSPECIFIED;
  switch (mcpType.toLowerCase()) {
    case 'text':
    case 'string':
      return Type.STRING;
    case 'number':
      return Type.NUMBER;
    case 'boolean':
      return Type.BOOLEAN;
    case 'integer':
      return Type.INTEGER;
    case 'array':
      return Type.ARRAY;
    case 'object':
      return Type.OBJECT;
    case 'null':
      return Type.NULL;
    default:
      return Type.TYPE_UNSPECIFIED;
  }
}

function getTypeFromArrayItem(mcpType: any): string | undefined {
  if (typeof mcpType === 'string') {
    return mcpType.toLowerCase();
  }
  return mcpType?.type?.toLowerCase?.();
}

export function toGeminiSchema(mcpSchema: any): Schema | undefined {
  if (!mcpSchema) {
    return undefined;
  }

  function recursiveConvert(mcp: any): Schema {
    const sourceType = mcp.anyOf ?? mcp.type;
    let isNullable = false;
    let nonNullTypes: any[];

    if (Array.isArray(sourceType)) {
      nonNullTypes = sourceType.filter((t: any) => getTypeFromArrayItem(t) !== 'null');
      isNullable = sourceType.some((t: any) => getTypeFromArrayItem(t) === 'null');

      if (nonNullTypes.length === 1) {
        const nonNullType = nonNullTypes[0];
        if (typeof nonNullType === 'object') {
          mcp = nonNullType;
        } else {
          const { type: _removed, anyOf: _removedAnyOf, ...rest } = mcp;
          mcp = { ...rest, type: nonNullType };
        }
      } else if (nonNullTypes.length === 0 && isNullable) {
        const { type: _removed, anyOf: _removedAnyOf, ...rest } = mcp;
        mcp = { ...rest, type: 'null' };
      } else if (typeof mcp.anyOf === 'undefined') {
        const anyOfItems = mcp.type.map((t: string) => ({ type: t }));
        const { type: _removed, ...rest } = mcp;
        mcp = { ...rest, anyOf: anyOfItems };
      }
    }

    if (!mcp.type) {
      if (mcp.properties || mcp.$ref) {
        mcp.type = 'object';
      } else if (mcp.items) {
        mcp.type = 'array';
      } else if (isNullable) {
        mcp.type = 'null';
      } else if (mcp.enum) {
        const enumTypes = new Set(mcp.enum.map((v: any) => typeof v));
        if (enumTypes.size === 1) {
          const jsType = [...enumTypes][0];
          if (jsType === 'string') mcp.type = 'string';
          else if (jsType === 'number') mcp.type = 'number';
          else if (jsType === 'boolean') mcp.type = 'boolean';
        }
      } else if (mcp.const !== undefined) {
        const jsType = typeof mcp.const;
        let inferredType;
        if (jsType === 'string') inferredType = 'string';
        else if (jsType === 'number') inferredType = 'number';
        else if (jsType === 'boolean') inferredType = 'boolean';
        mcp = { ...mcp, type: inferredType, enum: [mcp.const] };
      }
    }

    const geminiType = toGeminiType(mcp.type);
    const geminiSchema: Record<string, any> = {};

    if (mcp.anyOf) {
      geminiSchema.anyOf = mcp.anyOf.map((item: any) => recursiveConvert(item));
    } else {
      geminiSchema.type = geminiType;
    }

    if (mcp.description) {
      geminiSchema.description = mcp.description;
    }

    if (mcp.enum) {
      geminiSchema.enum = mcp.enum.map(String);
    }

    if (isNullable && mcp.type !== 'null') {
      geminiSchema.nullable = true;
    }

    if (geminiType === Type.OBJECT) {
      geminiSchema.properties = {};
      if (mcp.properties) {
        for (const name in mcp.properties) {
          geminiSchema.properties[name] = recursiveConvert(mcp.properties[name]);
        }
      }
      if (mcp.required) {
        geminiSchema.required = mcp.required;
      }
    } else if (geminiType === Type.ARRAY) {
      if (mcp.items) {
        geminiSchema.items = recursiveConvert(mcp.items);
      }
    }

    return geminiSchema as Schema;
  }

  return recursiveConvert(mcpSchema);
}
