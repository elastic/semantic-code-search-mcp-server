# Chain of Investigation

## Description

This prompt helps you start a "chain of investigation" to understand a codebase and accomplish a task. It follows a structured workflow that leverages the available tools to explore the code, analyze its components, and formulate a plan.

## Workflow

Structured workflow to understand codebases and accomplish tasks.

## Entry Points

### Option 1: Broad Semantic Search
When you have a concept but not specifics (e.g., "auth flow", "SLI logic"):
1. `semantic_code_search` → Find relevant chunks
2. Identify key files from results
3. `list_symbols_by_query` → Get file structure (optional but recommended)

### Option 2: Targeted Symbol Listing
When you know specific files/directories:
1. `list_symbols_by_query` → Direct query (e.g., `filePath: *src/utils*`)

## Investigation Flow
1. **Discover** → Use entry point above
2. **Analyze** → `symbol_analysis` on key symbols for connections
3. **Read** → `read_file_from_chunks` for implementation details
4. **Plan** → Create step-by-step changes
5. **Implement** → Execute modifications
6. **Verify** → Run tests and confirm

## Quick Examples
```json
// Broad search
{ "query": "authentication flow" }

// Targeted listing
{ "kql": "filePath: (*auth/service.ts OR *auth/controller.ts)" }

// Symbol deep-dive
{ "symbolName": "authenticateUser" }
```
