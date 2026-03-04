import { McpServer as SdkServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import path from 'path';
import express from 'express';
import { randomUUID } from 'crypto';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { oauthConfig } from '../config';
import { setupOAuth } from './auth/oauth';

import { semanticCodeSearch, semanticCodeSearchSchema } from './tools/semantic_code_search';
import { mapSymbolsByQuery, mapSymbolsByQuerySchema } from './tools/map_symbols_by_query';
import { symbolAnalysis, symbolAnalysisSchema } from './tools/symbol_analysis';
import { readFile, readFileSchema } from './tools/read_file';
import { documentSymbols, documentSymbolsSchema } from './tools/document_symbols';
import { listIndices, listIndicesSchema } from './tools/list_indices';
import { discoverDirectories, discoverDirectoriesSchema } from './tools/discover_directories';

import {
  createStartChainOfInvestigationHandler,
  startChainOfInvestigationSchema,
} from './prompts/chain_of_investigation';

/**
 * The main MCP server class.
 *
 * This class is responsible for creating and managing the MCP server,
 * registering tools, and starting the server with either a stdio or HTTP
 * transport.
 */
export class McpServer {
  // Tool descriptions are read once at startup and reused across sessions.
  private readonly descriptions: Record<string, string>;

  constructor() {
    this.descriptions = {
      semantic_code_search: fs.readFileSync(path.join(__dirname, 'tools/semantic_code_search.md'), 'utf-8'),
      map_symbols_by_query: fs.readFileSync(path.join(__dirname, 'tools/map_symbols_by_query.md'), 'utf-8'),
      symbol_analysis: fs.readFileSync(path.join(__dirname, 'tools/symbol_analysis.md'), 'utf-8'),
      read_file_from_chunks: fs.readFileSync(path.join(__dirname, 'tools/read_file.md'), 'utf-8'),
      document_symbols: fs.readFileSync(path.join(__dirname, 'tools/document_symbols.md'), 'utf-8'),
      list_indices: fs.readFileSync(path.join(__dirname, 'tools/list_indices.md'), 'utf-8'),
      discover_directories: fs.readFileSync(path.join(__dirname, 'tools/discover_directories.md'), 'utf-8'),
      chain_of_investigation: fs.readFileSync(
        path.join(__dirname, 'prompts/chain_of_investigation.workflow.md'),
        'utf-8'
      ),
    };
  }

  private withLogging<TArgs extends object>(
    name: string,
    fn: (args: TArgs) => Promise<CallToolResult>
  ): (args: TArgs) => Promise<CallToolResult> {
    return async (args: TArgs) => {
      const start = Date.now();
      console.error(`[tool] ${name} start`);
      try {
        const result = await fn(args);
        console.error(`[tool] ${name} ok (${Date.now() - start}ms)`);
        return result;
      } catch (err) {
        console.error(`[tool] ${name} error (${Date.now() - start}ms): ${err}`);
        throw err;
      }
    };
  }

  // Creates a fresh SdkServer instance per session so each session has its own
  // _transport reference. The MCP SDK's Protocol layer stores a single _transport
  // and overwrites it on every connect() call — sharing one server across sessions
  // causes responses to be routed to the most recently connected client.
  private createSdkServer(): SdkServer {
    const server = new SdkServer({
      name: 'semantic-code-search',
      version: '0.0.1',
      title: 'MCP Server for the Semantic Code Search Indexer',
    });

    server.registerTool(
      'semantic_code_search',
      { description: this.descriptions.semantic_code_search, inputSchema: semanticCodeSearchSchema.shape },
      this.withLogging('semantic_code_search', semanticCodeSearch)
    );
    server.registerTool(
      'map_symbols_by_query',
      { description: this.descriptions.map_symbols_by_query, inputSchema: mapSymbolsByQuerySchema.shape },
      this.withLogging('map_symbols_by_query', mapSymbolsByQuery)
    );
    server.registerTool(
      'symbol_analysis',
      { description: this.descriptions.symbol_analysis, inputSchema: symbolAnalysisSchema.shape },
      this.withLogging('symbol_analysis', symbolAnalysis)
    );
    server.registerTool(
      'read_file_from_chunks',
      { description: this.descriptions.read_file_from_chunks, inputSchema: readFileSchema.shape },
      this.withLogging('read_file_from_chunks', readFile)
    );
    server.registerTool(
      'document_symbols',
      { description: this.descriptions.document_symbols, inputSchema: documentSymbolsSchema.shape },
      this.withLogging('document_symbols', documentSymbols)
    );
    server.registerTool(
      'list_indices',
      { description: this.descriptions.list_indices, inputSchema: listIndicesSchema.shape },
      this.withLogging('list_indices', listIndices)
    );
    server.registerTool(
      'discover_directories',
      { description: this.descriptions.discover_directories, inputSchema: discoverDirectoriesSchema.shape },
      this.withLogging('discover_directories', discoverDirectories)
    );
    server.registerPrompt(
      'StartInvestigation',
      {
        description:
          'This prompt helps you start a "chain of investigation" to understand a codebase and accomplish a task. It follows a structured workflow that leverages the available tools to explore the code, analyze its components, and formulate a plan.',
        argsSchema: startChainOfInvestigationSchema.shape,
      },
      createStartChainOfInvestigationHandler(this.descriptions.chain_of_investigation)
    );

    return server;
  }

  /**
   * Starts the MCP server with a stdio transport.
   *
   * This is the default mode, and is used when the server is run from the
   * command line without any arguments.
   */
  public async start() {
    const transport = new StdioServerTransport();
    await this.createSdkServer().connect(transport);
  }

  /**
   * Starts the MCP server with an HTTP transport.
   *
   * This mode is used when the server is run with the `http` argument. It
   * creates an Express server and uses the `StreamableHTTPServerTransport`
   * to handle MCP requests over HTTP.
   *
   * When MCP_OAUTH_ENABLED=true, the server enforces OAuth 2.1 Bearer token
   * authentication on all /mcp routes and exposes the standard
   * /.well-known/oauth-protected-resource metadata endpoint (RFC9728).
   *
   * @param port The port to listen on.
   * @param serverUrl The canonical URL of this server. Used in OAuth metadata
   *   and audience validation. Defaults to http://localhost:<port>.
   */
  public async startHttp(port: number, serverUrl?: string) {
    // The MCP endpoint is mounted at /mcp. Per RFC 9728, the OAuth Protected Resource
    // Metadata `resource` field MUST equal the URL clients connect to (/mcp), not the
    // server root. We always derive the MCP resource URL from the base URL.
    const baseUrl = (serverUrl ?? `http://localhost:${port}`).replace(/\/$/, '');
    const mcpUrl = `${baseUrl}/mcp`;
    const app = express();
    app.use(express.json());

    app.use((req, res, next) => {
      const start = Date.now();
      const sid = (req.headers['mcp-session-id'] as string | undefined)?.slice(0, 8);
      const label = sid ? ` sid=${sid}` : '';
      const ua = (req.headers['user-agent'] ?? 'unknown').slice(0, 40);
      console.error(
        `[http] → ${req.method} ${req.path}${label} auth=${req.headers.authorization ? 'present' : 'none'} ua=${ua}`
      );
      res.on('finish', () => {
        console.error(
          `[http] ← ${req.method} ${req.path}${label} ${res.statusCode} (${Date.now() - start}ms) ua=${ua}`
        );
      });
      next();
    });

    if (oauthConfig.enabled) {
      if (!oauthConfig.issuer) {
        throw new Error(
          'MCP_OAUTH_ISSUER is required when MCP_OAUTH_ENABLED=true. ' +
            'Set it to your OIDC provider issuer URL, e.g. https://dev-xxx.okta.com/oauth2/default'
        );
      }
      await setupOAuth(app, oauthConfig, mcpUrl);
      console.error(
        `[oauth] OAuth enabled (issuer: ${oauthConfig.issuer}). ` +
          `Protected Resource Metadata: ${baseUrl}/.well-known/oauth-protected-resource`
      );
    }
    const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

    app.post('/mcp', async (req, res) => {
      // Disable Nagle's algorithm for POST responses too — tool call responses
      // are sent as inline SSE streams and benefit from immediate flushing.
      req.socket?.setNoDelay(true);
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      const rpcMethod = Array.isArray(req.body)
        ? req.body.map((m: { method?: string }) => m.method).join(',')
        : req.body?.method;
      if (rpcMethod) {
        console.error(`[rpc] method=${rpcMethod} session=${sessionId?.slice(0, 8) ?? 'new'}`);
      }
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            transports[newSessionId] = transport;
            console.error(`[session] created ${newSessionId} (active: ${Object.keys(transports).length})`);
          },
        });

        transport.onclose = () => {
          if (transport.sessionId) {
            delete transports[transport.sessionId];
            console.error(`[session] closed ${transport.sessionId} (active: ${Object.keys(transports).length})`);
          }
        };
        await this.createSdkServer().connect(transport);
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: No valid session ID provided',
          },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    });

    /**
     * A reusable handler for GET and DELETE requests that require a session ID.
     *
     * @param req The Express request object.
     * @param res The Express response object.
     */
    const handleSessionRequest = async (req: express.Request, res: express.Response) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId || !transports[sessionId]) {
        res.status(400).send('Invalid or missing session ID');
        return;
      }

      if (req.method === 'GET') {
        // Disable Nagle's algorithm so small SSE frames (pings, events) are not
        // coalesced and delayed by the TCP stack.
        req.socket?.setNoDelay(true);
        // Tell nginx / reverse proxies not to buffer the SSE stream.
        res.setHeader('X-Accel-Buffering', 'no');
        // SSE comment pings every 30 s keep the stream alive through idle timeouts.
        console.error(`[sse] open  session=${sessionId}`);
        const keepAlive = setInterval(() => {
          if (!res.writableEnded) res.write(': ping\n\n');
        }, 30_000);
        res.on('close', () => {
          clearInterval(keepAlive);
          console.error(`[sse] close session=${sessionId}`);
        });
      }

      const transport = transports[sessionId];
      await transport.handleRequest(req, res);
    };

    app.get('/mcp', handleSessionRequest);
    app.delete('/mcp', handleSessionRequest);

    const httpServer = app.listen(port, () => {
      console.log(`MCP HTTP server listening on port ${port}`);
    });

    // Node's default keepAliveTimeout is 5 s. If a client reuses a keep-alive
    // connection after 5 s of inactivity the server has already closed it,
    // causing an ECONNRESET that some clients interpret as a full disconnect.
    // Set to 65 s (> most reverse-proxy defaults) and headersTimeout slightly
    // above that so the two don't race.
    httpServer.keepAliveTimeout = 65_000;
    httpServer.headersTimeout = 66_000;
  }
}
