import { describe, it, expect, vi } from 'vitest';
import { WebMCPToolset, isWebMCPSupported } from './webmcp_toolset.ts';
import { WebMCPTool } from './webmcp_tool.ts';
import type { WebMCP } from 'webmcp-types';

describe('WebMCP Toolset & Tool', () => {
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
