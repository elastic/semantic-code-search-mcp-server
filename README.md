# Semantic Code Search MCP Server

This project includes a Model Context Protocol (MCP) server that exposes the indexed data through a standardized set of tools. This allows AI coding agents to interact with the indexed codebase in a structured way.

## Prerequisites

You must index your code base with the Semantic Code Search Indexer found here: https://github.com/elastic/semantic-code-search-indexer

### Index model expected by this MCP server

This MCP server expects the **locations-first** index model from indexer PR `elastic/semantic-code-search-indexer#135`:

- `<index>` stores **content-deduplicated chunk documents** (semantic search + metadata).
- `<index>_locations` stores **one document per chunk occurrence** (file path + line ranges + directory/git metadata) and references chunks by `chunk_id`.

Several tools query `<index>_locations` and join back to `<index>` via `chunk_id` (typically using `mget`).

## Running with Docker

The easiest way to run the MCP server is with Docker. The server is available on Docker Hub as `simianhacker/semantic-code-search-mcp-server`.

To ensure you have the latest version of the image, run the following command before running the server:

```bash
docker pull simianhacker/semantic-code-search-mcp-server
```

### HTTP Mode

This mode is useful for running the server in a containerized environment where it needs to be accessible over the network.

```bash
docker run --rm -p 3000:3000 \
  -e ELASTICSEARCH_ENDPOINT=<your_elasticsearch_endpoint> \
  simianhacker/semantic-code-search-mcp-server
```

Replace `<your_elasticsearch_endpoint>` with the actual endpoint of your Elasticsearch instance.

### STDIO Mode

This mode is useful for running the server as a local process that an agent can communicate with over `stdin` and `stdout`.

**With Elasticsearch Endpoint:**
```bash
docker run -i --rm \
  -e ELASTICSEARCH_ENDPOINT=<your_elasticsearch_endpoint> \
  simianhacker/semantic-code-search-mcp-server \
  node dist/src/mcp_server/bin.js stdio
```

**With Elastic Cloud ID:**
```bash
docker run -i --rm \
  -e ELASTICSEARCH_CLOUD_ID=<your_cloud_id> \
  -e ELASTICSEARCH_API_KEY=<your_api_key> \
  simianhacker/semantic-code-search-mcp-server \
  node dist/src/mcp_server/bin.js stdio
```

The `-i` flag is important as it tells Docker to run the container in interactive mode, which is necessary for the server to receive input from `stdin`.

### Connecting a Coding Agent

You can connect a coding agent to the server in either HTTP or STDIO mode.

**HTTP Mode:**
For agents that connect over HTTP, like the Gemini CLI, you can add the following to your `~/.gemini/settings.json` file:

```json
{
  "mcpServers": {
    "Semantic Code Search": {
      "trust": true,
      "httpUrl": "http://localhost:3000/mcp/",
    }
  }
}
```

**STDIO Mode:**
For agents that connect over STDIO, you need to configure them to run the Docker command directly. Here's an example for the Gemini CLI in your `~/.gemini/settings.json` file:

```json
{
  "mcpServers": {
    "SemanticCodeSearch": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "-e", "ELASTICSEARCH_CLOUD_ID=<your_cloud_id>",
        "-e", "ELASTICSEARCH_API_KEY=<your_api_key>",
        "-e", "ELASTICSEARCH_INDEX=<your_index>",
        "simianhacker/semantic-code-search-mcp-server",
        "node", "dist/src/mcp_server/bin.js", "stdio"
      ]
    }
  }
}
```
Remember to replace the placeholder values for your Cloud ID, API key, and index name.

## Setup and Installation

### 1. Prerequisites

-   Node.js (v20 or later)
-   npm
-   An running Elasticsearch instance (v8.0 or later) with the **ELSER model downloaded and deployed**.

### 2. Clone the Repository and Install Dependencies

```bash
git clone <repository-url>
cd semantic-code-search-mcp-server
npm install
```

### 3. Configure Environment Variables

Copy the `.env.example` file and update it with your Elasticsearch credentials.

```bash
cp .env.example .env
```

### 4. Compile the Code

The multi-threaded worker requires the project to be compiled to JavaScript.

```bash
npm run build
```


### Running the Server

The MCP server can be run in two modes:

**1. Stdio Mode:**
This is the default mode. The server communicates over `stdin` and `stdout`.

```bash
npm run mcp-server
```

**2. HTTP Mode:**
This mode is useful for running the server in a containerized environment like Docker.

```bash
npm run mcp-server:http
```

The server will listen on port 3000 by default. You can change the port by setting the `PORT` environment variable.

### Usage with NPX

You can also run the MCP server directly from the git repository using `npx`. This is a convenient way to run the server without having to clone the repository.

**Stdio Mode:**
```bash
ELASTICSEARCH_ENDPOINT=http://localhost:9200 npx github:elastic/semantic-code-search-mcp-server
```

**HTTP Mode:**
```bash
PORT=8080 ELASTICSEARCH_ENDPOINT=http://localhost:9200 npx github:elastic/semantic-code-search-mcp-server http
```

### Available Prompts

| Prompt | Description |
| --- | --- |
| `StartInvestigation` | This prompt helps you start a "chain of investigation" to understand a codebase and accomplish a task. It follows a structured workflow that leverages the available tools to explore the code, analyze its components, and formulate a plan. |

**Example:**
```
/StartInvestigation --task="add a new route to the kibana server"
```

### Available Tools

The MCP server provides the following tools:

| Tool | Description |
| --- | --- |
| `semantic_code_search` | Performs a semantic search on the code chunks in the index. This tool can combine a semantic query with a KQL filter to provide flexible and powerful search capabilities. |
| `map_symbols_by_query` | Query for a structured map of files containing specific symbols, grouped by file path. This is useful for finding all the symbols in a specific file or directory. Accepts an optional `size` parameter to control the number of files returned. |
| `symbol_analysis` | Analyzes a symbol and returns a report of its definitions, call sites, and references. This is useful for understanding the role of a symbol in the codebase. |
| `read_file_from_chunks` | Reads the content of a file from the index, providing a reconstructed view based on the most important indexed chunks. |
| `document_symbols` | Analyzes a file to identify the key symbols that would most benefit from documentation. This is useful for automating the process of improving the semantic quality of a codebase. |

**Note:** All of the tools accept an optional `index` parameter that allows you to override the `ELASTICSEARCH_INDEX` for a single query.

---

## Configuration

Configuration is managed via environment variables in a `.env` file.

| Variable | Description | Default |
| --- | --- | --- |
| `ELASTICSEARCH_CLOUD_ID` | The Cloud ID for your Elastic Cloud instance. | |
| `ELASTICSEARCH_API_KEY` | An API key for Elasticsearch authentication. | |
| `ELASTICSEARCH_INDEX` | The name of the Elasticsearch index to use. | `semantic-code-search` |