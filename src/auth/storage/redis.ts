/**
 * Redis backend for `OAuthStorage`.
 *
 * Persists OAuth/OIDC state (DCR clients, auth codes, refresh tokens, sessions, OIDC transactions)
 * with TTLs so the auth flow survives restarts and can be shared across instances.
 */
import { randomUUID } from 'crypto';
import Redis from 'ioredis';

import type {
  AuthCodeRecord,
  OAuthClientMetadata,
  OAuthStorage,
  OidcTxRecord,
  RefreshTokenRecord,
  UserSessionRecord,
} from './interface';

const json = {
  stringify: (value: unknown) => JSON.stringify(value),
  parse: <T>(value: string) => JSON.parse(value) as T,
};

/**
 * Redis-backed persistence for the OAuth/OIDC flow.
 *
 * Used by the OAuth routes to store client registrations, auth codes, refresh tokens,
 * user sessions, and transient OIDC transaction state with TTLs so the auth server can
 * be restarted or horizontally scaled without losing state mid-flow.
 */
export class RedisOAuthStorage implements OAuthStorage {
  private redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, { lazyConnect: false });
  }

  private keyClient(clientId: string) {
    return `oauth:client:${clientId}`;
  }
  private keyAuthCode(code: string) {
    return `oauth:code:${code}`;
  }
  private keyRefreshToken(hash: string) {
    return `oauth:rt:${hash}`;
  }
  private keySession(sessionId: string) {
    return `oauth:sess:${sessionId}`;
  }
  private keyOidcTx(txId: string) {
    return `oauth:oidctx:${txId}`;
  }

  async getClient(clientId: string): Promise<OAuthClientMetadata | null> {
    const raw = await this.redis.get(this.keyClient(clientId));
    if (!raw) return null;
    return json.parse<OAuthClientMetadata>(raw);
  }

  async createClient(client: OAuthClientMetadata): Promise<void> {
    await this.redis.set(this.keyClient(client.clientId), json.stringify(client));
  }

  async putAuthCode(record: AuthCodeRecord): Promise<void> {
    const ttlSeconds = Math.max(1, Math.ceil((record.expiresAtMs - Date.now()) / 1000));
    await this.redis.set(this.keyAuthCode(record.code), json.stringify(record), 'EX', ttlSeconds);
  }

  async consumeAuthCode(code: string): Promise<AuthCodeRecord | null> {
    const key = this.keyAuthCode(code);
    const raw = await this.redis.get(key);
    if (!raw) return null;
    await this.redis.del(key);
    const record = json.parse<AuthCodeRecord>(raw);
    if (Date.now() > record.expiresAtMs) return null;
    return record;
  }

  async putRefreshToken(record: RefreshTokenRecord): Promise<void> {
    const ttlSeconds = Math.max(1, Math.ceil((record.expiresAtMs - Date.now()) / 1000));
    await this.redis.set(this.keyRefreshToken(record.refreshTokenHash), json.stringify(record), 'EX', ttlSeconds);
  }

  async getRefreshTokenByHash(refreshTokenHash: string): Promise<RefreshTokenRecord | null> {
    const raw = await this.redis.get(this.keyRefreshToken(refreshTokenHash));
    if (!raw) return null;
    const record = json.parse<RefreshTokenRecord>(raw);
    if (Date.now() > record.expiresAtMs) return null;
    return record;
  }

  async deleteRefreshTokenByHash(refreshTokenHash: string): Promise<void> {
    await this.redis.del(this.keyRefreshToken(refreshTokenHash));
  }

  async putUserSession(record: UserSessionRecord): Promise<void> {
    const ttlSeconds = Math.max(1, Math.ceil((record.expiresAtMs - Date.now()) / 1000));
    await this.redis.set(this.keySession(record.sessionId), json.stringify(record), 'EX', ttlSeconds);
  }

  async getUserSession(sessionId: string): Promise<UserSessionRecord | null> {
    const raw = await this.redis.get(this.keySession(sessionId));
    if (!raw) return null;
    const record = json.parse<UserSessionRecord>(raw);
    if (Date.now() > record.expiresAtMs) return null;
    return record;
  }

  async deleteUserSession(sessionId: string): Promise<void> {
    await this.redis.del(this.keySession(sessionId));
  }

  async putOidcTx(record: OidcTxRecord): Promise<void> {
    const ttlSeconds = Math.max(1, Math.ceil((record.expiresAtMs - Date.now()) / 1000));
    await this.redis.set(this.keyOidcTx(record.txId), json.stringify(record), 'EX', ttlSeconds);
  }

  async consumeOidcTx(txId: string): Promise<OidcTxRecord | null> {
    const key = this.keyOidcTx(txId);
    const raw = await this.redis.get(key);
    if (!raw) return null;
    await this.redis.del(key);
    const record = json.parse<OidcTxRecord>(raw);
    if (Date.now() > record.expiresAtMs) return null;
    return record;
  }

  async acquireLock(key: string, ttlSeconds: number): Promise<string | null> {
    const token = randomUUID();
    const result = await this.redis.set(key, token, 'EX', ttlSeconds, 'NX');
    return result === 'OK' ? token : null;
  }

  async releaseLock(key: string, token: string): Promise<void> {
    const lua = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await this.redis.eval(lua, 1, key, token);
  }
}
