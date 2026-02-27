/**
 * In-memory backend for `OAuthStorage`.
 *
 * Supports the full OAuth/OIDC flow in a single process (DCR, auth codes, refresh tokens, sessions,
 * and OIDC transactions). Intended for local dev/tests only; state is not durable.
 */
import { randomUUID } from 'crypto';

import type {
  AuthCodeRecord,
  OAuthClientMetadata,
  OAuthStorage,
  OidcTxRecord,
  RefreshTokenRecord,
  UserSessionRecord,
} from './interface';

/**
 * In-memory persistence for the OAuth/OIDC flow.
 *
 * Used by the OAuth routes to store client registrations, short-lived auth codes,
 * refresh tokens, user sessions, and transient OIDC transaction state during login.
 * This is best suited for local dev/tests (state is lost on restart; not shared across replicas).
 */
export class MemoryOAuthStorage implements OAuthStorage {
  private clients = new Map<string, OAuthClientMetadata>();
  private authCodes = new Map<string, AuthCodeRecord>();
  private refreshTokens = new Map<string, RefreshTokenRecord>();
  private sessions = new Map<string, UserSessionRecord>();
  private oidcTxs = new Map<string, OidcTxRecord>();
  private locks = new Map<string, { token: string; expiresAtMs: number }>();

  async getClient(clientId: string): Promise<OAuthClientMetadata | null> {
    return this.clients.get(clientId) ?? null;
  }

  async createClient(client: OAuthClientMetadata): Promise<void> {
    this.clients.set(client.clientId, client);
  }

  async putAuthCode(record: AuthCodeRecord): Promise<void> {
    this.authCodes.set(record.code, record);
  }

  async consumeAuthCode(code: string): Promise<AuthCodeRecord | null> {
    const record = this.authCodes.get(code) ?? null;
    if (record) this.authCodes.delete(code);
    if (!record) return null;
    if (Date.now() > record.expiresAtMs) return null;
    return record;
  }

  async putRefreshToken(record: RefreshTokenRecord): Promise<void> {
    this.refreshTokens.set(record.refreshTokenHash, record);
  }

  async getRefreshTokenByHash(refreshTokenHash: string): Promise<RefreshTokenRecord | null> {
    const record = this.refreshTokens.get(refreshTokenHash) ?? null;
    if (!record) return null;
    if (Date.now() > record.expiresAtMs) return null;
    return record;
  }

  async deleteRefreshTokenByHash(refreshTokenHash: string): Promise<void> {
    this.refreshTokens.delete(refreshTokenHash);
  }

  async putUserSession(record: UserSessionRecord): Promise<void> {
    this.sessions.set(record.sessionId, record);
  }

  async getUserSession(sessionId: string): Promise<UserSessionRecord | null> {
    const record = this.sessions.get(sessionId) ?? null;
    if (!record) return null;
    if (Date.now() > record.expiresAtMs) return null;
    return record;
  }

  async deleteUserSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async putOidcTx(record: OidcTxRecord): Promise<void> {
    this.oidcTxs.set(record.txId, record);
  }

  async consumeOidcTx(txId: string): Promise<OidcTxRecord | null> {
    const record = this.oidcTxs.get(txId) ?? null;
    if (record) this.oidcTxs.delete(txId);
    if (!record) return null;
    if (Date.now() > record.expiresAtMs) return null;
    return record;
  }

  async acquireLock(key: string, ttlSeconds: number): Promise<string | null> {
    const existing = this.locks.get(key);
    if (existing && Date.now() < existing.expiresAtMs) return null;
    const token = randomUUID();
    this.locks.set(key, { token, expiresAtMs: Date.now() + ttlSeconds * 1000 });
    return token;
  }

  async releaseLock(key: string, token: string): Promise<void> {
    const existing = this.locks.get(key);
    if (!existing) return;
    if (existing.token !== token) return;
    this.locks.delete(key);
  }
}
