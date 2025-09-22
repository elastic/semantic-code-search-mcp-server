# Document Symbols

## Description

Analyzes a file to identify the key symbols that would most benefit from documentation.

This tool is designed to be used in an automated workflow for improving the semantic quality of a codebase. It identifies the most important symbols in a file by comparing the reconstructed version of the file (from the `read_file_from_chunks` tool) with the list of all symbols in the file.

An AI coding agent can use this tool to get a focused list of symbols to document, and then generate JSDoc comments for each one.

## Parameters

- `filePath` (`string`): The relative path to the project of the file to analyze.

## Returns

A list of the key symbols in the file that should be documented. Each symbol will include its name, kind, and location.
