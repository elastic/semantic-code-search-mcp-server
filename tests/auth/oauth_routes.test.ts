import express from 'express';

import type { OAuthConfig } from '../../src/config';
import { MemoryOAuthStorage } from '../../src/auth/storage/memory';
import { hashRefreshToken } from '../../src/auth/token_utils';
import { sha256Base64url } from '../../src/auth/crypto';
import { withHttpServer } from './test_server';

jest.mock('../../src/auth/tokens', () => {
  const signAccessToken = async (opts: {
    issuer: string;
    audience: string;
    subject: string;
    scope: string;
    extraClaims?: Record<string, unknown>;
  }) => {
    const payload = {
      iss: opts.issuer,
      aud: opts.audience,
      sub: opts.subject,
      scope: opts.scope,
      iat: 1,
      exp: 999999999,
      ...(opts.extraClaims ?? {}),
    };
    return `fake.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;
  };

  const verifyAccessToken = async (opts: { token: string }) => {
    const parts = opts.token.split('.');
    if (parts.length < 2) throw new Error('bad token');
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
    return payload;
  };

  return { signAccessToken, verifyAccessToken };
});

const jsonObject = async (res: Response): Promise<Record<string, unknown>> => {
  const j: unknown = await res.json();
  if (!j || typeof j !== 'object' || Array.isArray(j)) {
    throw new Error('Expected JSON object');
  }
  return j as Record<string, unknown>;
};

const makeCfg = (): OAuthConfig => ({
  oauthServerUrl: 'http://mcp.test',
  jwtSigningSecret: 'test-signing-secret',
  oidcIssuer: 'https://issuer.example',
  oidcClientId: 'client',
  oidcClientSecret: 'secret',
  oidcCookieSecret: 'cookie-secret',
  oidcRequiredClaims: ['sub', 'email'],
  oauthStorage: 'memory',
  debugEnabled: false,
});

const makeApp = async (cfg: OAuthConfig, storage: MemoryOAuthStorage) => {
  // Import after jest.mock so routes pick up mocked token functions.
  const { registerDcrRoutes } = await import('../../src/auth/routes/register');
  const { registerTokenRoutes } = await import('../../src/auth/routes/token');
  const { registerWellKnownRoutes } = await import('../../src/auth/routes/well_known');

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  const router = express.Router();
  registerWellKnownRoutes(router, cfg);
  registerDcrRoutes(router, cfg, storage);
  registerTokenRoutes(router, cfg, storage);
  app.use(router);

  return app;
};

describe('oauth routes (well-known, DCR, token)', () => {
  test('well-known endpoints respond with CORS and metadata', async () => {
    const cfg = makeCfg();
    const storage = new MemoryOAuthStorage();
    const app = await makeApp(cfg, storage);

    const srv = await withHttpServer(app);
    try {
      const prm = await fetch(`${srv.baseUrl}/.well-known/oauth-protected-resource`);
      expect(prm.status).toBe(200);
      expect(prm.headers.get('access-control-allow-origin')).toBe('*');
      const prmJson = await jsonObject(prm);
      expect(prmJson.authorization_servers).toEqual(expect.arrayContaining([cfg.oauthServerUrl]));
      expect(prmJson.scopes_supported).toEqual(expect.arrayContaining(['mcp:read']));

      const as = await fetch(`${srv.baseUrl}/.well-known/oauth-authorization-server`);
      expect(as.status).toBe(200);
      expect(as.headers.get('access-control-allow-origin')).toBe('*');
      const asJson = await jsonObject(as);
      expect(asJson.issuer).toBe(cfg.oauthServerUrl);
      expect(asJson.registration_endpoint).toBe(`${cfg.oauthServerUrl}/oauth/register`);
      expect(asJson.code_challenge_methods_supported).toEqual(expect.arrayContaining(['S256']));
    } finally {
      await srv.close();
    }
  });

  test('DCR accepts cursor:// redirect URIs', async () => {
    const cfg = makeCfg();
    const storage = new MemoryOAuthStorage();
    const app = await makeApp(cfg, storage);
    const srv = await withHttpServer(app);

    try {
      const res = await fetch(`${srv.baseUrl}/oauth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Cursor',
          redirect_uris: ['cursor://anysphere.cursor-mcp/oauth/callback'],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
          scope: 'mcp:read',
        }),
      });

      expect(res.status).toBe(201);
      const json = await jsonObject(res);
      expect(typeof json.client_id).toBe('string');
      expect(json.token_endpoint_auth_method).toBe('none');
      expect(json.redirect_uris).toEqual(expect.arrayContaining(['cursor://anysphere.cursor-mcp/oauth/callback']));
    } finally {
      await srv.close();
    }
  });

  test('DCR rejects non-https/non-localhost/non-cursor redirect URIs', async () => {
    const cfg = makeCfg();
    const storage = new MemoryOAuthStorage();
    const app = await makeApp(cfg, storage);
    const srv = await withHttpServer(app);

    try {
      const res = await fetch(`${srv.baseUrl}/oauth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Bad',
          redirect_uris: ['ftp://example.com/callback'],
          token_endpoint_auth_method: 'none',
        }),
      });
      expect(res.status).toBe(400);
      const json = await jsonObject(res);
      expect(json.error).toBe('invalid_redirect_uri');
    } finally {
      await srv.close();
    }
  });

  test('token endpoint exchanges auth code and rotates refresh token', async () => {
    const cfg = makeCfg();
    const storage = new MemoryOAuthStorage();
    const app = await makeApp(cfg, storage);
    const srv = await withHttpServer(app);

    try {
      const clientId = 'test-client';
      await storage.createClient({
        clientId,
        redirectUris: ['http://localhost/callback'],
        grantTypes: ['authorization_code', 'refresh_token'],
        responseTypes: ['code'],
        tokenEndpointAuthMethod: 'none',
        createdAtMs: Date.now(),
      });

      const codeVerifier = 'verifier-123';
      const codeChallenge = sha256Base64url(codeVerifier);
      const code = 'code-abc';
      await storage.putAuthCode({
        code,
        clientId,
        redirectUri: 'http://localhost/callback',
        codeChallenge,
        codeChallengeMethod: 'S256',
        scope: 'mcp:read',
        userClaims: { sub: 'user-1', email: 'user@example.com' },
        expiresAtMs: Date.now() + 60_000,
      });

      const tokenRes = await fetch(`${srv.baseUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: clientId,
          code,
          redirect_uri: 'http://localhost/callback',
          code_verifier: codeVerifier,
        }),
      });
      expect(tokenRes.status).toBe(200);
      const tokenJson = await jsonObject(tokenRes);
      expect(typeof tokenJson.access_token).toBe('string');
      expect(typeof tokenJson.refresh_token).toBe('string');

      const token = tokenJson.access_token as string;
      const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as Record<
        string,
        unknown
      >;
      expect(payload.sub).toBe('user-1');
      expect(payload.email).toBe('user@example.com');

      const oldRefresh = tokenJson.refresh_token as string;
      const oldHash = hashRefreshToken(cfg.jwtSigningSecret, oldRefresh);
      expect(await storage.getRefreshTokenByHash(oldHash)).not.toBeNull();

      const refreshRes = await fetch(`${srv.baseUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          client_id: clientId,
          refresh_token: oldRefresh,
        }),
      });
      expect(refreshRes.status).toBe(200);
      const refreshJson = await jsonObject(refreshRes);
      expect(typeof refreshJson.refresh_token).toBe('string');
      expect(refreshJson.refresh_token).not.toBe(oldRefresh);

      // old refresh token should be invalid after rotation
      const reuseRes = await fetch(`${srv.baseUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          client_id: clientId,
          refresh_token: oldRefresh,
        }),
      });
      expect(reuseRes.status).toBe(400);
      const reuseJson = await jsonObject(reuseRes);
      expect(reuseJson.error).toBe('invalid_grant');
    } finally {
      await srv.close();
    }
  });
});
