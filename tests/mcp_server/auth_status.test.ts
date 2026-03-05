import { createAuthStatusHandler } from '../../src/mcp_server/tools/auth_status';

const ISSUER = 'https://dev-xxx.okta.com/oauth2/default';

function makeExtra(authInfo?: { token?: string; clientId?: string; scopes?: string[]; expiresAt?: number }) {
  if (!authInfo) return { authInfo: undefined };
  return {
    authInfo: {
      token: authInfo.token ?? 'test-token',
      clientId: authInfo.clientId ?? 'test-client',
      scopes: authInfo.scopes ?? [],
      expiresAt: authInfo.expiresAt,
    },
  };
}

function parseResult(result: Awaited<ReturnType<ReturnType<typeof createAuthStatusHandler>>>) {
  const text = (result.content[0] as { type: 'text'; text: string }).text;
  return JSON.parse(text) as Record<string, unknown>;
}

describe('createAuthStatusHandler', () => {
  it('returns authenticated:false when no authInfo', async () => {
    const handler = createAuthStatusHandler(ISSUER);
    const result = await handler({}, makeExtra());
    expect(parseResult(result)).toEqual({ authenticated: false });
  });

  it('returns clientId and scopes from authInfo', async () => {
    const handler = createAuthStatusHandler(ISSUER);
    const result = await handler(
      {},
      makeExtra({ token: 'tok', clientId: 'my-client', scopes: ['openid', 'email'], expiresAt: 9999999999 })
    );
    const data = parseResult(result);
    expect(data.authenticated).toBe(true);
    expect(data.clientId).toBe('my-client');
    expect(data.scopes).toEqual(['openid', 'email']);
  });

  it('includes the issuer', async () => {
    const handler = createAuthStatusHandler(ISSUER);
    const result = await handler({}, makeExtra({ token: 'tok', clientId: 'c', scopes: [], expiresAt: 9999999999 }));
    expect(parseResult(result).issuer).toBe(ISSUER);
  });

  it('formats expiresAt as ISO string', async () => {
    const expiresAt = 2000000000; // 2033-05-18
    const handler = createAuthStatusHandler(ISSUER);
    const result = await handler({}, makeExtra({ token: 'tok', clientId: 'c', scopes: [], expiresAt }));
    const data = parseResult(result);
    expect(data.expiresAt).toBe(new Date(expiresAt * 1000).toISOString());
  });

  it('computes a human-readable expiresIn', async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3661; // 1h 1m 1s from now
    const handler = createAuthStatusHandler(ISSUER);
    const result = await handler({}, makeExtra({ token: 'tok', clientId: 'c', scopes: [], expiresAt }));
    const data = parseResult(result);
    // Should be "61m Xs"
    expect((data.expiresIn as string).startsWith('61m')).toBe(true);
  });

  it('reports "expired" when expiresAt is in the past', async () => {
    const expiresAt = Math.floor(Date.now() / 1000) - 60;
    const handler = createAuthStatusHandler(ISSUER);
    const result = await handler({}, makeExtra({ token: 'tok', clientId: 'c', scopes: [], expiresAt }));
    expect(parseResult(result).expiresIn).toBe('expired');
  });

  it('sets expiresAt and expiresIn to null when no exp claim', async () => {
    const handler = createAuthStatusHandler(ISSUER);
    const result = await handler({}, makeExtra({ token: 'tok', clientId: 'c', scopes: [] }));
    const data = parseResult(result);
    expect(data.expiresAt).toBeNull();
    expect(data.expiresIn).toBeNull();
  });

  it('never includes the token value in the output', async () => {
    const handler = createAuthStatusHandler(ISSUER);
    const result = await handler({}, makeExtra({ token: 'super-secret-bearer-token', clientId: 'c', scopes: [] }));
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).not.toContain('super-secret-bearer-token');
  });

  it('works without an issuer configured', async () => {
    const handler = createAuthStatusHandler(undefined);
    const result = await handler({}, makeExtra({ token: 'tok', clientId: 'c', scopes: [] }));
    expect(parseResult(result).issuer).toBeUndefined();
  });
});
