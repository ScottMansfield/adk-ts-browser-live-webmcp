import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebMCPToolset, isWebMCPSupported } from './webmcp_toolset.ts';
import { WebMCPTool, resetWebMCPArgEncoding } from './webmcp_tool.ts';
import type { WebMCP } from 'webmcp-types';

const sampleTool: WebMCP.RegisteredTool = {
  name: 'search_flights',
  title: 'Search',
  description: 'Search flights',
  origin: 'https://example.com',
  window: {} as Window,
};

describe('executeTool argument encoding', () => {
  beforeEach(() => resetWebMCPArgEncoding());

  it('falls back to a JSON string when the browser cannot parse an object', async () => {
    // Reproduces pre-Chrome-155 behavior: object args yield
    // {error: "Failed to parse input arguments"} and never run the tool.
    const executeTool = vi.fn(async (_tool: any, args: any) =>
      typeof args === 'string'
        ? { count: 2, flights: ['SB-101'] }
        : { error: 'Failed to parse input arguments' }
    );
    const doc = { modelContext: { executeTool } } as unknown as Document;

    const tool = new WebMCPTool(sampleTool, undefined, doc);
    const result = await tool.runAsync({ args: { destination: 'Tokyo' } } as any);

    expect(result).toEqual({ count: 2, flights: ['SB-101'] });
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(executeTool.mock.calls[0][1]).toEqual({ destination: 'Tokyo' });
    expect(executeTool.mock.calls[1][1]).toBe('{"destination":"Tokyo"}');
  });

  it('reuses the negotiated encoding without re-probing', async () => {
    const executeTool = vi.fn(async (_tool: any, args: any) =>
      typeof args === 'string' ? { ok: true } : { error: 'Failed to parse input arguments' }
    );
    const doc = { modelContext: { executeTool } } as unknown as Document;
    const tool = new WebMCPTool(sampleTool, undefined, doc);

    await tool.runAsync({ args: { a: 1 } } as any);
    expect(executeTool).toHaveBeenCalledTimes(2);

    await tool.runAsync({ args: { b: 2 } } as any);
    // Second call goes straight to the known-good encoding.
    expect(executeTool).toHaveBeenCalledTimes(3);
    expect(executeTool.mock.calls[2][1]).toBe('{"b":2}');
  });

  it('does not retry when the object form works', async () => {
    const executeTool = vi.fn(async (_tool: any, _args: any) => ({ ok: true }));
    const doc = { modelContext: { executeTool } } as unknown as Document;
    const tool = new WebMCPTool(sampleTool, undefined, doc);

    await tool.runAsync({ args: { destination: 'Tokyo' } } as any);
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool.mock.calls[0][1]).toEqual({ destination: 'Tokyo' });
  });

  it('propagates unrelated tool errors without retrying', async () => {
    const executeTool = vi.fn(async () => {
      throw new Error('Flight service unavailable');
    });
    const doc = { modelContext: { executeTool } } as unknown as Document;
    const tool = new WebMCPTool(sampleTool, undefined, doc);

    await expect(tool.runAsync({ args: {} } as any)).rejects.toThrow('Flight service unavailable');
    expect(executeTool).toHaveBeenCalledTimes(1);
  });
});

describe('inputSchema shapes from the browser', () => {
  const schema = {
    type: 'object',
    properties: { flightId: { type: 'string', description: 'e.g. SB-101' } },
    required: ['flightId'],
  };

  it('keeps parameters when the schema arrives as an object', () => {
    const tool = new WebMCPTool({ ...sampleTool, name: 'select_flight', inputSchema: schema });
    const params = tool._getDeclaration()?.parameters as any;
    expect(params.properties.flightId.type).toBe('STRING');
    expect(params.required).toEqual(['flightId']);
  });

  it('parses a schema that arrives as a JSON string', () => {
    // Without this the declaration collapses to TYPE_UNSPECIFIED and the model
    // has no property names to fill in, so it calls with {}.
    const tool = new WebMCPTool({
      ...sampleTool,
      name: 'select_flight',
      inputSchema: JSON.stringify(schema) as unknown as object,
    });
    const params = tool._getDeclaration()?.parameters as any;
    expect(params.type).toBe('OBJECT');
    expect(params.properties.flightId.type).toBe('STRING');
    expect(params.required).toEqual(['flightId']);
  });

  it('declares an empty object when there is no schema', () => {
    const tool = new WebMCPTool({ ...sampleTool, name: 'no_args', inputSchema: undefined });
    const params = tool._getDeclaration()?.parameters as any;
    expect(params.type).toBe('OBJECT');
    expect(params.properties).toEqual({});
  });

  it('degrades to no parameters on an unparseable schema string', () => {
    const tool = new WebMCPTool({
      ...sampleTool,
      name: 'broken',
      inputSchema: 'not json' as unknown as object,
    });
    const params = tool._getDeclaration()?.parameters as any;
    expect(params.type).toBe('OBJECT');
    expect(params.properties).toEqual({});
  });
});

describe('WebMCP Toolset & Tool', () => {
  beforeEach(() => resetWebMCPArgEncoding());

  it('detects WebMCP support correctly', () => {
    const mockDocWithout = {} as Document;
    expect(isWebMCPSupported(mockDocWithout)).toBe(false);

    const mockDocWith = {
      modelContext: {
        getTools: vi.fn(),
        registerTool: vi.fn(),
      },
    } as unknown as Document;
    expect(isWebMCPSupported(mockDocWith)).toBe(true);
  });

  it('translates WebMCP tool schema to Gemini function declaration', () => {
    const rawTool: WebMCP.RegisteredTool = {
      name: 'search_flights',
      title: 'Search Flights',
      description: 'Search for available flights',
      inputSchema: {
        type: 'object',
        properties: {
          destination: { type: 'string', description: 'City or airport code' },
          passengers: { type: 'number', description: 'Count of passengers' },
          class: { type: 'string', enum: ['economy', 'business'] },
        },
        required: ['destination'],
      },
      origin: 'https://example.com',
      window: {} as Window,
      annotations: {
        readOnlyHint: true,
        consequentialHint: false,
      },
    };

    const tool = new WebMCPTool(rawTool);
    const decl = tool._getDeclaration();

    expect(decl).toBeDefined();
    expect(decl?.name).toBe('search_flights');
    expect(decl?.description).toBe('Search for available flights');
    expect(decl?.parameters?.type).toBe('OBJECT');
    expect(decl?.parameters?.properties?.destination.type).toBe('STRING');
    expect(decl?.parameters?.properties?.passengers.type).toBe('NUMBER');
    expect(decl?.parameters?.properties?.class.type).toBe('STRING');
    expect(decl?.parameters?.properties?.class.enum).toEqual(['economy', 'business']);
    expect(decl?.parameters?.required).toEqual(['destination']);
  });

  it('correctly flags consequentialHint for human confirmation', async () => {
    const safeTool = new WebMCPTool({
      name: 'safe_search',
      title: 'Safe Search',
      description: 'Safe action',
      origin: 'https://example.com',
      window: {} as Window,
      annotations: { consequentialHint: false },
    });
    expect(await safeTool.checkRequireConfirmation({})).toBe(false);

    const dangerousTool = new WebMCPTool({
      name: 'book_ticket',
      title: 'Book Ticket',
      description: 'Charges credit card',
      origin: 'https://example.com',
      window: {} as Window,
      annotations: { consequentialHint: true },
    });
    expect(await dangerousTool.checkRequireConfirmation({})).toBe(true);
  });

  it('executes tool via document.modelContext.executeTool', async () => {
    const executeTool = vi.fn().mockResolvedValue({ status: 'confirmed', bookingId: 'BK-123' });
    const mockDoc = {
      modelContext: {
        executeTool,
      },
    } as unknown as Document;

    const rawTool: WebMCP.RegisteredTool = {
      name: 'book_flight',
      title: 'Book Flight',
      description: 'Book flight',
      origin: 'https://example.com',
      window: {} as Window,
    };

    const tool = new WebMCPTool(rawTool, undefined, mockDoc);
    const result = await tool.runAsync({
      args: { flightId: 'FL-902' },
    } as any);

    expect(executeTool).toHaveBeenCalledWith(
      rawTool,
      { flightId: 'FL-902' },
      undefined
    );
    expect(result).toEqual({ status: 'confirmed', bookingId: 'BK-123' });
  });

  it('loads, filters, and prefixes tools in WebMCPToolset', async () => {
    const mockTools: WebMCP.RegisteredTool[] = [
      {
        name: 'search',
        title: 'Search',
        description: 'Search catalog',
        origin: 'https://example.com',
        window: {} as Window,
      },
      {
        name: 'delete_account',
        title: 'Delete',
        description: 'Delete user',
        origin: 'https://example.com',
        window: {} as Window,
      },
    ];

    const mockDoc = {
      modelContext: {
        getTools: vi.fn().mockResolvedValue(mockTools),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    } as unknown as Document;

    // Test with prefix and filter
    const toolset = new WebMCPToolset({
      document: mockDoc,
      prefix: 'web',
      toolFilter: ['web_search'],
    });

    const tools = await toolset.getTools();
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe('web_search');
  });
});
