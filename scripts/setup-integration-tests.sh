#!/bin/bash
set -e

# Check for Docker Compose v2
if ! docker compose version &> /dev/null; then
  echo "ERROR: Docker Compose v2 not found."
  echo "Please install Docker Desktop (Mac/Windows) or Docker Engine with Compose plugin (Linux)."
  echo "See: https://docs.docker.com/compose/install/"
  exit 1
fi

echo "Starting Elasticsearch for integration tests..."
docker compose -f docker-compose.integration.yml up -d

echo "Waiting for Elasticsearch to be ready..."
timeout=180
elapsed=0
while ! curl -s -u elastic:testpassword -f http://localhost:9200/_cluster/health >/dev/null; do
  if [ $elapsed -ge $timeout ]; then
    echo "ERROR: Elasticsearch did not start within $timeout seconds"
    docker compose -f docker-compose.integration.yml logs
    exit 1
  fi
  echo "Waiting for Elasticsearch... ($elapsed/$timeout seconds)"
  sleep 5
  elapsed=$((elapsed + 5))
done

echo "Elasticsearch is ready!"
echo ""
echo "✅ Integration test environment is ready!"
echo "   Elasticsearch: http://localhost:9200"
echo "   Username: elastic"
echo "   Password: testpassword"
echo ""

