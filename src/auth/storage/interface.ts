/**
 * Storage contract for the OAuth/OIDC flow.
 *
 * The OAuth endpoints persist and consume records (client registrations, auth codes, refresh tokens,
 * user sessions, and OIDC transactions) through this interface so we can swap in-memory vs Redis.
 */
export type OAuthClientMetadata = {
  clientId: string;
  clientName?: string;
  clientUri?: string;
  redirectUris: string[];
  grantTypes: string[];
  responseTypes: string[];
  tokenEndpointAuthMethod: 'none';
  scope?: string;
  createdAtMs: number;
};

export type AuthCodeRecord = {
  code: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  scope: string;
  resource?: string;
  userClaims: Record<string, unknown>;
  expiresAtMs: number;
};

export type RefreshTokenRecord = {
  refreshTokenHash: string;
  clientId: string;
  scope: string;
  resource?: string;
  userClaims: Record<string, unknown>;
  expiresAtMs: number;
  createdAtMs: number;
};

export type UserSessionRecord = {
  sessionId: string;
  userClaims: Record<string, unknown>;
  upstreamRefreshTokenEnc?: string;
  createdAtMs: number;
  expiresAtMs: number;
};

export type OidcTxRecord = {
  txId: string;
  codeVerifier: string;
  nonce?: string;
  createdAtMs: number;
  expiresAtMs: number;
};

export interface OAuthStorage {
  getClient(clientId: string): Promise<OAuthClientMetadata | null>;
  createClient(client: OAuthClientMetadata): Promise<void>;

  putAuthCode(record: AuthCodeRecord): Promise<void>;
  consumeAuthCode(code: string): Promise<AuthCodeRecord | null>;

  putRefreshToken(record: RefreshTokenRecord): Promise<void>;
  getRefreshTokenByHash(refreshTokenHash: string): Promise<RefreshTokenRecord | null>;
  deleteRefreshTokenByHash(refreshTokenHash: string): Promise<void>;

  putUserSession(record: UserSessionRecord): Promise<void>;
  getUserSession(sessionId: string): Promise<UserSessionRecord | null>;
  deleteUserSession(sessionId: string): Promise<void>;

  putOidcTx(record: OidcTxRecord): Promise<void>;
  consumeOidcTx(txId: string): Promise<OidcTxRecord | null>;

  acquireLock(key: string, ttlSeconds: number): Promise<string | null>;
  releaseLock(key: string, token: string): Promise<void>;
}
