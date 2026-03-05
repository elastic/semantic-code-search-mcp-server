import { McpServer as SdkServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import fs from 'fs';
import path from 'path';
import express from 'express';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { oauthConfig } from '../config';
import { setupOAuth } from './auth/oauth';

import { createAuthStatusHandler, authStatusSchema } from './tools/auth_status';
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

  // Creates a fresh SdkServer instance per request. The MCP SDK's Protocol
  // layer stores a single _transport reference — sharing one instance across
  // requests causes responses to be routed to the wrong client.
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
    if (oauthConfig.enabled) {
      server.registerTool(
        'auth_status',
        {
          description:
            'Returns your current OAuth authentication status: which client app you authenticated with, what scopes your token has, and when it expires. Only available when OAuth is enabled.',
          inputSchema: authStatusSchema.shape,
        },
        createAuthStatusHandler(oauthConfig.issuer)
      );
    }

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
   */
  public async start() {
    const transport = new StdioServerTransport();
    await this.createSdkServer().connect(transport);
  }

  /**
   * Starts the MCP server with a stateless HTTP transport.
   *
   * Each POST request gets a fresh SdkServer + StreamableHTTPServerTransport
   * with no session ID. This makes the server fully stateless: no in-memory
   * session map, no SSE connections, no sticky sessions required on the load
   * balancer.
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
    const expectedOrigin = new URL(mcpUrl).origin;
    const app = express();
    app.use(express.json());

    app.use((req, res, next) => {
      const start = Date.now();
      const ua = (req.headers['user-agent'] ?? 'unknown').slice(0, 40);
      console.error(
        `[http] → ${req.method} ${req.path} auth=${req.headers.authorization ? 'present' : 'none'} ua=${ua}`
      );
      res.on('finish', () => {
        console.error(`[http] ← ${req.method} ${req.path} ${res.statusCode} (${Date.now() - start}ms) ua=${ua}`);
      });
      next();
    });

    // Origin validation — MCP spec (2025-03-26), Transports Security Warning:
    // Servers MUST validate the Origin header to prevent DNS rebinding attacks.
    // MCP clients (Claude Code, VS Code, Cursor) are not browsers and do not send Origin.
    // When a browser-originated request includes Origin, we reject it unless it matches
    // the server's own origin, blocking DNS rebinding while not affecting MCP clients.
    app.use('/mcp', (req, res, next) => {
      const origin = req.headers.origin;
      if (origin && origin !== expectedOrigin) {
        console.error(`[security] Rejected request: Origin "${origin}" != expected "${expectedOrigin}"`);
        res.status(403).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Forbidden' },
          id: null,
        });
        return;
      }
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

    app.post('/mcp', async (req, res) => {
      req.socket?.setNoDelay(true);
      const rpcMethod = Array.isArray(req.body)
        ? req.body.map((m: { method?: string }) => m.method).join(',')
        : req.body?.method;
      if (rpcMethod) {
        console.error(`[rpc] method=${rpcMethod}`);
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless: no session IDs
      });
      const sdkServer = this.createSdkServer();

      res.on('close', () => {
        transport.close();
      });

      try {
        await sdkServer.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (err) {
        console.error(`[http] POST /mcp error: ${err}`);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          });
        }
      }
    });

    // Stateless mode: no SSE (GET) or session deletion (DELETE).
    const methodNotAllowed = (_req: express.Request, res: express.Response) => {
      res.status(405).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed.' },
        id: null,
      });
    };
    app.get('/mcp', methodNotAllowed);
    app.delete('/mcp', methodNotAllowed);

    // MCP spec (2025-03-26), Transports Security Warning: when running locally,
    // servers SHOULD bind only to 127.0.0.1, not 0.0.0.0, to reduce the attack
    // surface. When MCP_SERVER_URL is set to a non-localhost URL (i.e. deployed
    // in a container or behind a reverse proxy) we bind to all interfaces so the
    // container's network stack can reach us.
    const isLocal =
      !serverUrl || new URL(baseUrl).hostname === 'localhost' || new URL(baseUrl).hostname === '127.0.0.1';
    const bindHost = isLocal ? '127.0.0.1' : '0.0.0.0';
    const httpServer = app.listen(port, bindHost, () => {
      console.log(`MCP HTTP server listening on ${bindHost}:${port}`);
    });

    // Node's default keepAliveTimeout is 5 s. If a client reuses a keep-alive
    // connection after 5 s of inactivity the server has already closed it,
    // causing an ECONNRESET. Set to 65 s (> most reverse-proxy defaults).
    httpServer.keepAliveTimeout = 65_000;
    httpServer.headersTimeout = 66_000;
  }
}
