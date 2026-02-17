/**
 * Dynamic Client Registration (DCR) for OAuth clients
 * Stores registered OAuth clients in memory
 */

export interface OAuthClient {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  created_at: number;
}

// In-memory client store (use Redis/DB in production)
const clients = new Map<string, OAuthClient>();

/**
 * Register a new OAuth client dynamically
 */
export function registerClient(
  redirectUris: string[],
  grantTypes: string[] = ['authorization_code', 'refresh_token'],
  responseTypes: string[] = ['code']
): OAuthClient {
  const client: OAuthClient = {
    client_id: `dcr_${crypto.randomUUID()}`,
    client_secret: crypto.randomUUID(),
    redirect_uris: redirectUris,
    grant_types: grantTypes,
    response_types: responseTypes,
    token_endpoint_auth_method: 'client_secret_post',
    created_at: Date.now(),
  };

  clients.set(client.client_id, client);

  // Auto-cleanup after 7 days
  setTimeout(() => clients.delete(client.client_id), 7 * 24 * 60 * 60 * 1000);

  return client;
}

/**
 * Get a registered client by ID
 */
export function getClient(clientId: string): OAuthClient | undefined {
  return clients.get(clientId);
}

/**
 * Validate client credentials
 */
export function validateClient(clientId: string, clientSecret: string): boolean {
  const client = clients.get(clientId);
  return client !== undefined && client.client_secret === clientSecret;
}

/**
 * Check if redirect URI is registered for client
 */
export function isValidRedirectUri(clientId: string, redirectUri: string): boolean {
  const client = clients.get(clientId);
  return client !== undefined && client.redirect_uris.includes(redirectUri);
}
