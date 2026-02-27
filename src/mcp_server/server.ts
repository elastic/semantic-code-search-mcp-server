import { McpServer as SdkServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import fs from 'fs';
import path from 'path';
import express from 'express';
import type http from 'http';

import { loadOauthConfig, oauthEnabled } from '../config';
import { createOAuthRouter } from '../auth/router';
import { bearerAuth } from '../auth/middleware';
import { createOAuthStorage } from '../auth/storage';

import { semanticCodeSearch, semanticCodeSearchSchema } from './tools/semantic_code_search';
import { mapSymbolsByQuery, mapSymbolsByQuerySchema } from './tools/map_symbols_by_query';
import { symbolAnalysis, symbolAnalysisSchema } from './tools/symbol_analysis';
import { readFile, readFileSchema } from './tools/read_file';
import { documentSymbols, documentSymbolsSchema } from './tools/document_symbols';
import { listIndices, listIndicesSchema } from './tools/list_indices';
import { discoverDirectories, discoverDirectoriesSchema } from './tools/discover_directories';
import { whoami, whoamiSchema } from './tools/whoami';

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
  private server: SdkServer;
  private httpServer: http.Server | null = null;

  constructor() {
    this.server = this.createSdkServer();
  }

  private createSdkServer(): SdkServer {
    const server = new SdkServer({
      name: 'semantic-code-search',
      version: '0.0.1',
      title: 'MCP Server for the Semantic Code Search Indexer',
    });
    this.registerTools(server);
    return server;
  }

  private registerTools(server: SdkServer) {
    const semanticCodeSearchDescription = fs.readFileSync(
      path.join(__dirname, 'tools/semantic_code_search.md'),
      'utf-8'
    );
    const symbolAnalysisDescription = fs.readFileSync(path.join(__dirname, 'tools/symbol_analysis.md'), 'utf-8');
    const mapSymbolsByQueryDescription = fs.readFileSync(
      path.join(__dirname, 'tools/map_symbols_by_query.md'),
      'utf-8'
    );

    server.registerTool(
      'semantic_code_search',
      {
        description: semanticCodeSearchDescription,
        inputSchema: semanticCodeSearchSchema.shape,
      },
      semanticCodeSearch
    );

    server.registerTool(
      'map_symbols_by_query',
      {
        description: mapSymbolsByQueryDescription,
        inputSchema: mapSymbolsByQuerySchema.shape,
      },
      mapSymbolsByQuery
    );

    server.registerTool(
      'symbol_analysis',
      {
        description: symbolAnalysisDescription,
        inputSchema: symbolAnalysisSchema.shape,
      },
      symbolAnalysis
    );

    const readFileDescription = fs.readFileSync(path.join(__dirname, 'tools/read_file.md'), 'utf-8');
    server.registerTool(
      'read_file_from_chunks',
      {
        description: readFileDescription,
        inputSchema: readFileSchema.shape,
      },
      readFile
    );

    const documentSymbolsDescription = fs.readFileSync(path.join(__dirname, 'tools/document_symbols.md'), 'utf-8');
    server.registerTool(
      'document_symbols',
      {
        description: documentSymbolsDescription,
        inputSchema: documentSymbolsSchema.shape,
      },
      documentSymbols
    );

    const listIndicesDescription = fs.readFileSync(path.join(__dirname, 'tools/list_indices.md'), 'utf-8');
    server.registerTool(
      'list_indices',
      {
        description: listIndicesDescription,
        inputSchema: listIndicesSchema.shape,
      },
      listIndices
    );

    const discoverDirectoriesDescription = fs.readFileSync(
      path.join(__dirname, 'tools/discover_directories.md'),
      'utf-8'
    );
    server.registerTool(
      'discover_directories',
      {
        description: discoverDirectoriesDescription,
        inputSchema: discoverDirectoriesSchema.shape,
      },
      discoverDirectories
    );

    if (oauthEnabled) {
      const whoamiDescription = fs.readFileSync(path.join(__dirname, 'tools/whoami.md'), 'utf-8');
      server.registerTool(
        'whoami',
        {
          description: whoamiDescription,
          inputSchema: whoamiSchema.shape,
        },
        whoami
      );
    }

    const chainOfInvestigationWorkflowMarkdown = fs.readFileSync(
      path.join(__dirname, 'prompts/chain_of_investigation.workflow.md'),
      'utf-8'
    );

    server.registerPrompt(
      'StartInvestigation',
      {
        description:
          'This prompt helps you start a "chain of investigation" to understand a codebase and accomplish a task. It follows a structured workflow that leverages the available tools to explore the code, analyze its components, and formulate a plan.',
        argsSchema: startChainOfInvestigationSchema.shape,
      },
      createStartChainOfInvestigationHandler(chainOfInvestigationWorkflowMarkdown)
    );
  }

  /**
   * Starts the MCP server with a stdio transport.
   *
   * This is the default mode, and is used when the server is run from the
   * command line without any arguments.
   */
  public async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }

  /**
   * Starts the MCP server with an HTTP transport.
   *
   * This mode is used when the server is run with the `http` argument. It
   * creates an Express server and uses the `StreamableHTTPServerTransport`
   * to handle MCP requests over HTTP.
   *
   * @param port The port to listen on.
   */
  public async startHttp(port: number) {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    if (oauthEnabled) {
      app.set('trust proxy', true);
    }

    const oauthCfg = oauthEnabled ? loadOauthConfig() : null;
    if (oauthEnabled && oauthCfg) {
      const storage = createOAuthStorage(oauthCfg);
      app.use(createOAuthRouter(oauthCfg, storage));
    }

    const maybeAuth = oauthEnabled && oauthCfg ? bearerAuth(oauthCfg) : undefined;

    app.post('/mcp', ...(maybeAuth ? [maybeAuth] : []), async (req, res) => {
      // Stateless Streamable HTTP: no Mcp-Session-Id; create transport/server per request.
      const server = this.createSdkServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch {
        res.status(500).send('Internal Server Error');
      }
    });

    // This server does not provide a standalone GET SSE stream in stateless mode.
    // Clients should use POST responses (JSON or SSE) only.
    const methodNotAllowed = (_req: express.Request, res: express.Response) => res.sendStatus(405);
    if (maybeAuth) {
      app.get('/mcp', maybeAuth, methodNotAllowed);
      app.delete('/mcp', maybeAuth, methodNotAllowed);
    } else {
      app.get('/mcp', methodNotAllowed);
      app.delete('/mcp', methodNotAllowed);
    }

    await new Promise<void>((_resolve, reject) => {
      this.httpServer = app.listen(port, () => {
        console.log(`MCP HTTP server listening on port ${port}`);
      });
      this.httpServer.on('error', (err) => reject(err));
      // Intentionally never resolve: keeps the process alive in CLI usage.
      // The server stays up until process termination or explicit close().
    });
  }
}
