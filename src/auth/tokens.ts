/**
 * Access token (JWT) primitives used by the OAuth token endpoint and MCP bearer auth.
 *
 * We issue short-lived HS256 JWTs to clients and verify them on the protected MCP endpoint.
 */
export type AccessTokenClaims = {
  sub: string;
  iss: string;
  aud: string;
  scope: string;
  [key: string]: unknown;
};

const textEncoder = new TextEncoder();

const getJose = async () => (await import('jose')) as typeof import('jose');

const secretKey = (secret: string) => {
  return textEncoder.encode(secret);
};

export const signAccessToken = async (opts: {
  signingSecret: string;
  issuer: string;
  audience: string;
  subject: string;
  scope: string;
  ttlSeconds: number;
  extraClaims?: Record<string, unknown>;
}) => {
  const { SignJWT } = await getJose();
  const now = Math.floor(Date.now() / 1000);
  const jwt = new SignJWT({ scope: opts.scope, ...(opts.extraClaims ?? {}) })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setIssuer(opts.issuer)
    .setAudience(opts.audience)
    .setSubject(opts.subject)
    .setExpirationTime(now + opts.ttlSeconds);

  return await jwt.sign(secretKey(opts.signingSecret));
};

export const verifyAccessToken = async (opts: {
  token: string;
  signingSecret: string;
  issuer: string;
  audience: string;
}) => {
  const { jwtVerify } = await getJose();
  const { payload } = await jwtVerify(opts.token, secretKey(opts.signingSecret), {
    issuer: opts.issuer,
    audience: opts.audience,
  });
  return payload as unknown as AccessTokenClaims;
};
