import { McpServer as SdkServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import path from 'path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';

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

import { authMiddleware } from '../middleware/auth';
import { authRouter } from '../routes/auth';
import { oauthRouter } from '../routes/oauth';
import { oidcConfig } from '../config';
import { getOIDCDiscovery } from '../lib/oidc';
import { logger } from '../lib/logger';

/**
 * The main MCP server class.
 *
 * This class is responsible for creating and managing the MCP server,
 * registering tools, and starting the server with either a stdio or HTTP
 * transport.
 */
export class McpServer {
  private server: SdkServer;

  constructor() {
    this.server = new SdkServer({
      name: 'semantic-code-search',
      version: '0.0.1',
      title: 'MCP Server for the Semantic Code Search Indexer',
    });
    this.registerTools();
  }

  private registerTools() {
    const semanticCodeSearchDescription = fs.readFileSync(
      path.join(__dirname, 'tools/semantic_code_search.md'),
      'utf-8'
    );
    const symbolAnalysisDescription = fs.readFileSync(path.join(__dirname, 'tools/symbol_analysis.md'), 'utf-8');
    const mapSymbolsByQueryDescription = fs.readFileSync(
      path.join(__dirname, 'tools/map_symbols_by_query.md'),
      'utf-8'
    );

    this.server.registerTool(
      'semantic_code_search',
      {
        description: semanticCodeSearchDescription,
        inputSchema: semanticCodeSearchSchema.shape,
      },
      semanticCodeSearch
    );

    this.server.registerTool(
      'map_symbols_by_query',
      {
        description: mapSymbolsByQueryDescription,
        inputSchema: mapSymbolsByQuerySchema.shape,
      },
      mapSymbolsByQuery
    );

    this.server.registerTool(
      'symbol_analysis',
      {
        description: symbolAnalysisDescription,
        inputSchema: symbolAnalysisSchema.shape,
      },
      symbolAnalysis
    );

    const readFileDescription = fs.readFileSync(path.join(__dirname, 'tools/read_file.md'), 'utf-8');
    this.server.registerTool(
      'read_file_from_chunks',
      {
        description: readFileDescription,
        inputSchema: readFileSchema.shape,
      },
      readFile
    );

    const documentSymbolsDescription = fs.readFileSync(path.join(__dirname, 'tools/document_symbols.md'), 'utf-8');
    this.server.registerTool(
      'document_symbols',
      {
        description: documentSymbolsDescription,
        inputSchema: documentSymbolsSchema.shape,
      },
      documentSymbols
    );

    const listIndicesDescription = fs.readFileSync(path.join(__dirname, 'tools/list_indices.md'), 'utf-8');
    this.server.registerTool(
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
    this.server.registerTool(
      'discover_directories',
      {
        description: discoverDirectoriesDescription,
        inputSchema: discoverDirectoriesSchema.shape,
      },
      discoverDirectories
    );

    const chainOfInvestigationWorkflowMarkdown = fs.readFileSync(
      path.join(__dirname, 'prompts/chain_of_investigation.workflow.md'),
      'utf-8'
    );

    this.server.registerPrompt(
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
    app.use(express.urlencoded({ extended: true })); // For OAuth token endpoint
    app.use(cookieParser());
    const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

    // Auth routes (public, no auth required)
    app.use('/auth', authRouter);

    // OAuth routes for Dynamic Client Registration (public, no auth required)
    app.use('/oauth', oauthRouter);

    // OAuth discovery endpoint (public, no auth required)
    app.get('/.well-known/oauth-authorization-server', async (req, res) => {
      if (!oidcConfig.enabled || !oidcConfig.issuer) {
        res.status(404).json({
          error: 'OIDC authentication is not enabled',
        });
        return;
      }

      try {
        const discovery = await getOIDCDiscovery();
        const baseUrl = `${req.protocol}://${req.get('host')}`;

        res.json({
          issuer: baseUrl,
          authorization_endpoint: `${baseUrl}/oauth/authorize`,
          token_endpoint: `${baseUrl}/oauth/token`,
          registration_endpoint: `${baseUrl}/oauth/register`,
          jwks_uri: discovery.jwks_uri,
          scopes_supported: discovery.scopes_supported || ['openid', 'profile', 'email'],
          response_types_supported: discovery.response_types_supported || ['code'],
          grant_types_supported: discovery.grant_types_supported || ['authorization_code', 'refresh_token'],
          token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
          code_challenge_methods_supported: ['S256'],
        });
      } catch (error) {
        logger.error('Discovery', 'Failed to fetch OIDC discovery', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        res.status(500).json({
          error: 'Failed to fetch OIDC discovery information',
        });
      }
    });

    // Apply auth middleware to all /mcp routes
    app.use('/mcp', authMiddleware);

    app.post('/mcp', async (req, res) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            transports[newSessionId] = transport;
          },
        });

        transport.onclose = () => {
          if (transport.sessionId) {
            delete transports[transport.sessionId];
          }
        };
        await this.server.connect(transport);
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

      const transport = transports[sessionId];
      await transport.handleRequest(req, res);
    };

    app.get('/mcp', handleSessionRequest);
    app.delete('/mcp', handleSessionRequest);

    app.listen(port, () => {
      logger.info('Server', `MCP HTTP server listening on port ${port}`);
      if (oidcConfig.enabled) {
        logger.info('Server', 'OIDC authentication enabled', {
          issuer: oidcConfig.issuer,
          required_claims: oidcConfig.requiredClaims.join(', '),
        });
      }
    });
  }
}
