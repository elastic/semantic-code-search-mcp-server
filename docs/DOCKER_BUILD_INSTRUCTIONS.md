# Docker Build Instructions

This document provides the instructions for building, running, and pushing the Docker image for the Semantic Code Search MCP Server.

## Building the Image

To build the Docker image, run the following command from the root of the project:

```bash
docker build -t simianhacker/semantic-code-search-mcp-server .
```

## Running the Container

To run the Docker container, use the following command:

```bash
docker run -p 3000:3000 \
  -e ELASTICSEARCH_ENDPOINT=<your_elasticsearch_endpoint> \
  simianhacker/semantic-code-search-mcp-server
```

Replace `<your_elasticsearch_endpoint>` with the actual endpoint of your Elasticsearch instance.

## Pushing the Image to Docker Hub

First, log in to Docker Hub:

```bash
docker login
```

Then, push the image:

```bash
docker push simianhacker/semantic-code-search-mcp-server
```
