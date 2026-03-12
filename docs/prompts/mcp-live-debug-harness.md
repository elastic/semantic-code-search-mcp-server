# Project Proposal: MCP Live-Debug Harness

## High-Level Summary

This document outlines a plan to build a new, separate MCP server application whose sole purpose is to wrap and debug another MCP server (the "target server"). When a user connects their Inspector to this new "Harness" server, it will automatically start the target server as a background process. The Harness will expose "debug" versions of all the target's tools. When a debug tool is called, the Harness will call the *real* tool on the target, capture both its JSON response and any console logs, and return them to the user in a single, clean package.

Crucially, the Harness will use a file watcher for live reloading. When a change is saved to the target server's source code, the Harness will automatically kill the old process, rebuild the code, and start the new version, making the development cycle nearly instantaneous.

## Key Technologies

*   **Backend:** Node.js with TypeScript (for the Harness server itself).
*   **Core Library:** `@modelcontextprotocol/sdk` (both client and server components).
*   **Live Reload:** `nodemon` to watch for file changes and automatically restart the target server.
*   **Process Management:** Node.js `child_process` to spawn and manage the target server.

## Core Features & User Interaction

1.  **Live Reloading:** The user will start the Harness server with a command like `npm run debug:harness`. It will watch the target server's `src` directory. When a `.ts` file is saved, it will automatically run `npm run build` and restart the target server.
2.  **Dynamic Proxy Tools:** The Harness will connect to the target server and automatically discover its tools (e.g., `list_indices`). It will then dynamically register its own tools, prefixed with `debug_` (e.g., `debug_list_indices`).
3.  **Log Interception:** The Harness will listen to the standard output (`stdout`) and standard error (`stderr`) of the target server process.
4.  **Combined Output:** When a user calls `debug_list_indices`, the Harness will:
    *   Call the real `list_indices` tool on the target server.
    *   Capture the JSON result.
    *   Capture any `console.log` messages the target server printed during the execution.
    *   Return a single, structured response to the Inspector, like this:
        ```json
        {
          "result": {
            "content": [
              {
                "type": "text",
                "text": "Index: beats\n- Files: 10,460 total..."
              }
            ]
          },
          "logs": [
            "DEBUGGING: listIndices function was called.",
            "Connecting to Elasticsearch...",
            "Alias query successful."
          ]
        }
        ```

The user would connect their Inspector to the Harness server's port, and from there they could seamlessly edit the target server's code and test the results live without ever restarting a process manually.
