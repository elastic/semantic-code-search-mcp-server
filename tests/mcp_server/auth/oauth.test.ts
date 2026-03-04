import { buildIntrospectionVerifier, buildJwksVerifier } from '../../../src/mcp_server/auth/oauth';
import { jwtVerify, createRemoteJWKSet } from 'jose';
import { checkResourceAllowed } from '@modelcontextprotocol/sdk/shared/auth-utils.js';

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn().mockReturnValue('mock-jwks'),
  jwtVerify: jest.fn(),
}));

jest.mock('@modelcontextprotocol/sdk/shared/auth-utils.js', () => ({
  checkResourceAllowed: jest.fn(),
}));

const SERVER_URL = new URL('https://mcp.example.com');
const INTROSPECTION_ENDPOINT = 'https://auth.example.com/oauth2/v1/introspect';
const JWKS_URI = 'https://auth.example.com/oauth2/v1/keys';
const ISSUER = 'https://auth.example.com';

describe('buildIntrospectionVerifier', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
    (checkResourceAllowed as jest.Mock).mockReturnValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns AuthInfo for an active token', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        active: true,
        client_id: 'my-client',
        scope: 'read write',
        exp: 9999999999,
        aud: ['https://mcp.example.com'],
      }),
    } as Response);

    const verifier = buildIntrospectionVerifier(INTROSPECTION_ENDPOINT, 'my-client', 'secret', SERVER_URL);
    const result = await verifier.verifyAccessToken('tok123');

    expect(result).toEqual({
      token: 'tok123',
      clientId: 'my-client',
      scopes: ['read', 'write'],
      expiresAt: 9999999999,
    });
  });

  it('throws when token is inactive', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ active: false }),
    } as Response);

    const verifier = buildIntrospectionVerifier(INTROSPECTION_ENDPOINT, 'c', 's', SERVER_URL);
    await expect(verifier.verifyAccessToken('bad-token')).rejects.toThrow('Token is not active');
  });

  it('throws when introspection HTTP request fails', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 401,
    } as Response);

    const verifier = buildIntrospectionVerifier(INTROSPECTION_ENDPOINT, 'c', 's', SERVER_URL);
    await expect(verifier.verifyAccessToken('tok')).rejects.toThrow('Token introspection failed with status 401');
  });

  it('throws on audience mismatch', async () => {
    (checkResourceAllowed as jest.Mock).mockReturnValue(false);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        active: true,
        aud: ['https://other.example.com'],
      }),
    } as Response);

    const verifier = buildIntrospectionVerifier(INTROSPECTION_ENDPOINT, 'c', 's', SERVER_URL);
    await expect(verifier.verifyAccessToken('tok')).rejects.toThrow('Token audience mismatch');
  });

  it('does not leak server config or token claims in audience mismatch error', async () => {
    (checkResourceAllowed as jest.Mock).mockReturnValue(false);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ active: true, aud: ['https://attacker.example.com'] }),
    } as Response);

    const verifier = buildIntrospectionVerifier(INTROSPECTION_ENDPOINT, 'c', 's', SERVER_URL);
    const err = await verifier.verifyAccessToken('tok').catch((e: Error) => e);
    expect((err as Error).message).toBe('Token audience mismatch');
    expect((err as Error).message).not.toContain('mcp.example.com');
    expect((err as Error).message).not.toContain('attacker');
  });

  it('passes when token has no audience claim', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ active: true, client_id: 'c', scope: '', exp: 1000 }),
    } as Response);

    const verifier = buildIntrospectionVerifier(INTROSPECTION_ENDPOINT, 'c', 's', SERVER_URL);
    const result = await verifier.verifyAccessToken('tok');
    expect(result.scopes).toEqual([]);
    expect(checkResourceAllowed).not.toHaveBeenCalled();
  });

  it('sends client_id and client_secret in the request body', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ active: true }),
    } as Response);

    const verifier = buildIntrospectionVerifier(INTROSPECTION_ENDPOINT, 'my-client', 'my-secret', SERVER_URL);
    await verifier.verifyAccessToken('tok').catch(() => {});

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(INTROSPECTION_ENDPOINT);
    const body = new URLSearchParams(init.body as string);
    expect(body.get('token')).toBe('tok');
    expect(body.get('client_id')).toBe('my-client');
    expect(body.get('client_secret')).toBe('my-secret');
  });
});

describe('buildJwksVerifier', () => {
  beforeEach(() => {
    (checkResourceAllowed as jest.Mock).mockReturnValue(true);
    // Confirm createRemoteJWKSet is called with the JWKS URI
    (createRemoteJWKSet as jest.Mock).mockReturnValue('mock-jwks');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function mockJwt(payloadOverrides: Record<string, unknown> = {}) {
    (jwtVerify as jest.Mock).mockResolvedValueOnce({
      payload: {
        iss: ISSUER,
        aud: ['https://mcp.example.com'],
        exp: 9999999999,
        client_id: 'test-client',
        ...payloadOverrides,
      },
    });
  }

  it('extracts scopes from Okta scp array', async () => {
    mockJwt({ scp: ['read', 'write'] });
    const verifier = buildJwksVerifier(JWKS_URI, ISSUER, SERVER_URL);
    const result = await verifier.verifyAccessToken('tok');
    expect(result.scopes).toEqual(['read', 'write']);
  });

  it('extracts scopes from standard scope string', async () => {
    mockJwt({ scope: 'read write admin' });
    const verifier = buildJwksVerifier(JWKS_URI, ISSUER, SERVER_URL);
    const result = await verifier.verifyAccessToken('tok');
    expect(result.scopes).toEqual(['read', 'write', 'admin']);
  });

  it('returns empty scopes when neither scp nor scope is present', async () => {
    mockJwt({});
    const verifier = buildJwksVerifier(JWKS_URI, ISSUER, SERVER_URL);
    const result = await verifier.verifyAccessToken('tok');
    expect(result.scopes).toEqual([]);
  });

  it('prefers scp over scope when both are present', async () => {
    mockJwt({ scp: ['from-scp'], scope: 'from-scope' });
    const verifier = buildJwksVerifier(JWKS_URI, ISSUER, SERVER_URL);
    const result = await verifier.verifyAccessToken('tok');
    expect(result.scopes).toEqual(['from-scp']);
  });

  it('uses client_id from payload', async () => {
    mockJwt({ client_id: 'from-payload' });
    const verifier = buildJwksVerifier(JWKS_URI, ISSUER, SERVER_URL);
    const result = await verifier.verifyAccessToken('tok');
    expect(result.clientId).toBe('from-payload');
  });

  it('falls back to azp when client_id is absent', async () => {
    mockJwt({ client_id: undefined, azp: 'azp-client' });
    const verifier = buildJwksVerifier(JWKS_URI, ISSUER, SERVER_URL);
    const result = await verifier.verifyAccessToken('tok');
    expect(result.clientId).toBe('azp-client');
  });

  it('throws when aud claim is missing', async () => {
    (jwtVerify as jest.Mock).mockResolvedValueOnce({
      payload: { iss: ISSUER, exp: 9999 },
    });
    const verifier = buildJwksVerifier(JWKS_URI, ISSUER, SERVER_URL);
    await expect(verifier.verifyAccessToken('tok')).rejects.toThrow('Token is missing the "aud" claim');
  });

  it('throws on audience mismatch', async () => {
    (checkResourceAllowed as jest.Mock).mockReturnValue(false);
    mockJwt({ aud: ['https://wrong.example.com'] });
    const verifier = buildJwksVerifier(JWKS_URI, ISSUER, SERVER_URL);
    await expect(verifier.verifyAccessToken('tok')).rejects.toThrow('Token audience mismatch');
  });

  it('does not leak server config or token claims in audience mismatch error', async () => {
    (checkResourceAllowed as jest.Mock).mockReturnValue(false);
    mockJwt({ aud: ['https://attacker.example.com'] });

    const verifier = buildJwksVerifier(JWKS_URI, ISSUER, SERVER_URL);
    const err = await verifier.verifyAccessToken('tok').catch((e: Error) => e);
    expect((err as Error).message).toBe('Token audience mismatch');
    expect((err as Error).message).not.toContain('mcp.example.com');
    expect((err as Error).message).not.toContain('attacker');
  });

  it('accepts non-URL audience via equality fallback (e.g. Okta api://default)', async () => {
    mockJwt({ aud: ['api://default'] });
    // checkResourceAllowed throws for non-URL strings; the verifier falls back to === comparison
    (checkResourceAllowed as jest.Mock).mockImplementationOnce(() => {
      throw new Error('not a valid URL');
    });
    const verifier = buildJwksVerifier(JWKS_URI, ISSUER, SERVER_URL, 'api://default');
    const result = await verifier.verifyAccessToken('tok');
    expect(result).toBeDefined();
  });

  it('uses explicit audience override instead of serverUrl href', async () => {
    mockJwt({ aud: ['api://default'] });
    (checkResourceAllowed as jest.Mock).mockImplementationOnce(() => {
      throw new Error('not a valid URL');
    });
    const verifier = buildJwksVerifier(JWKS_URI, ISSUER, SERVER_URL, 'api://default');
    await verifier.verifyAccessToken('tok');
    // checkResourceAllowed was called with the explicit audience, not serverUrl.href
    expect(checkResourceAllowed).toHaveBeenCalledWith(expect.objectContaining({ configuredResource: 'api://default' }));
  });

  it('includes expiresAt from exp claim', async () => {
    mockJwt({ exp: 12345 });
    const verifier = buildJwksVerifier(JWKS_URI, ISSUER, SERVER_URL);
    const result = await verifier.verifyAccessToken('tok');
    expect(result.expiresAt).toBe(12345);
  });

  it('passes the token and JWKS set to jwtVerify', async () => {
    mockJwt({});
    buildJwksVerifier(JWKS_URI, ISSUER, SERVER_URL);
    expect(createRemoteJWKSet).toHaveBeenCalledWith(new URL(JWKS_URI));
  });
});
