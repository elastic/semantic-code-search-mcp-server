#!/usr/bin/env node
/**
 * This is the main entry point for the MCP server.
 *
 * It parses the command-line arguments to determine whether to start the
 * server in stdio or HTTP mode, and then creates and starts the server.
 */
import { McpServer } from './server';

const serverType = process.argv[2] || 'stdio';

const server = new McpServer();

if (serverType === 'stdio') {
  server.start();
} else if (serverType === 'http') {
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  server.startHttp(port);
} else {
  console.error(`Unknown server type: ${serverType}`);
  process.exit(1);
}
