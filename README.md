# Semantic Code Search MCP Server

This project includes a Model Context Protocol (MCP) server that exposes the indexed data through a standardized set of tools. This allows AI coding agents to interact with the indexed codebase in a structured way.

## Prerequisites

You must index your code base with the Semantic Code Search Indexer found here: https://github.com/elastic/semantic-code-search-indexer

## Running with Docker

The easiest way to run the MCP server is with Docker. The server is available on Docker Hub as `simianhacker/semantic-code-search-mcp-server`.

```bash
docker run -p 3000:3000 \
  -e ELASTICSEARCH_ENDPOINT=<your_elasticsearch_endpoint> \
  simianhacker/semantic-code-search-mcp-server
```

Replace `<your_elasticsearch_endpoint>` with the actual endpoint of your Elasticsearch instance.

### Connecting a Coding Agent

Once the server is running, you can connect your coding agent to it. For example, to connect the Gemini CLI, you would add the following to your `~/.gemini/settings.json` file:

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
| `StartInvestigation` | A prompt that guides the user through a "chain of investigation" to understand a codebase and accomplish a task. |

**Example:**
```
/StartInvestigation --task="add a new route to the kibana server"
```

### Available Tools

The MCP server provides the following tools:

| Tool | Description |
| --- | --- |
| `semantic_code_search` | Performs a semantic search on the code chunks in the index. This tool can combine a semantic query with a KQL filter to provide flexible and powerful search capabilities. |
| `list_symbols_by_query` | Lists symbols that match a given KQL query. This is useful for finding all the symbols in a specific file or directory. |
| `symbol_analysis` | Analyzes a symbol and returns a report of its definitions, call sites, and references. This is useful for understanding the role of a symbol in the codebase. |
| `read_file_from_chunks` | Reads the content of a file from the index, providing a reconstructed view based on the most important indexed chunks. |
| `document_symbols` | Analyzes a file to identify the key symbols that would most benefit from documentation. This is useful for automating the process of improving the semantic quality of a codebase. |

---

## Configuration

Configuration is managed via environment variables in a `.env` file.

| Variable | Description | Default |
| --- | --- | --- |
| `ELASTICSEARCH_CLOUD_ID` | The Cloud ID for your Elastic Cloud instance. | |
| `ELASTICSEARCH_API_KEY` | An API key for Elasticsearch authentication. | |
| `ELASTICSEARCH_INDEX` | The name of the Elasticsearch index to use. | `semantic-code-search` |
