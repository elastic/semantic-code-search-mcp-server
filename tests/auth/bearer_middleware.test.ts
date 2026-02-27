import express from 'express';

import type { OAuthConfig } from '../../src/config';
import { bearerAuth } from '../../src/auth/middleware';
import { withHttpServer } from './test_server';

jest.mock('../../src/auth/tokens', () => {
  const verifyAccessToken = async (opts: { token: string }) => {
    if (opts.token === 'bad') throw new Error('bad token');
    if (opts.token === 'missing-email')
      return { sub: 'user-1', scope: 'mcp:read', iss: 'http://mcp.test', aud: 'http://mcp.test' };
    return {
      sub: 'user-1',
      email: 'user@example.com',
      scope: 'mcp:read',
      iss: 'http://mcp.test',
      aud: 'http://mcp.test',
    };
  };
  return { verifyAccessToken };
});

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

describe('bearerAuth middleware', () => {
  test('returns 401 with WWW-Authenticate resource_metadata when missing token', async () => {
    const cfg = makeCfg();
    const app = express();
    app.post('/mcp', bearerAuth(cfg), (_req, res) => res.status(200).send('ok'));

    const srv = await withHttpServer(app);
    try {
      const res = await fetch(`${srv.baseUrl}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
      const h = res.headers.get('www-authenticate') || '';
      expect(h).toContain('Bearer');
      expect(h).toContain('resource_metadata=');
      expect(h).toContain(`${cfg.oauthServerUrl}/.well-known/oauth-protected-resource`);
    } finally {
      await srv.close();
    }
  });

  test('returns 401 invalid_token for bad token', async () => {
    const cfg = makeCfg();
    const app = express();
    app.post('/mcp', bearerAuth(cfg), (_req, res) => res.status(200).send('ok'));

    const srv = await withHttpServer(app);
    try {
      const res = await fetch(`${srv.baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer bad',
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
      const h = res.headers.get('www-authenticate') || '';
      expect(h).toContain('invalid_token');
    } finally {
      await srv.close();
    }
  });

  test('returns 403 when required claims missing', async () => {
    const cfg = makeCfg();
    const app = express();
    app.post('/mcp', bearerAuth(cfg), (_req, res) => res.status(200).send('ok'));

    const srv = await withHttpServer(app);
    try {
      const res = await fetch(`${srv.baseUrl}/mcp`, {
        method: 'POST',
        headers: { authorization: 'Bearer missing-email', 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(403);
    } finally {
      await srv.close();
    }
  });
});
