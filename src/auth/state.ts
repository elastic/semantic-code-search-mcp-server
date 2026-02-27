/**
 * Signed, expiring state blobs for OAuth/OIDC redirects and consent.
 *
 * Used to carry transient data across browser redirects (e.g. OIDC transaction IDs, original OAuth
 * request parameters) with integrity and expiration.
 */
import { base64url, hmacSha256Hex, timingSafeEqualStr } from './crypto';

export type SignedState<T> = {
  payload: T;
  iat: number;
  exp: number;
};

export const signState = <T>(secret: string, payload: T, ttlSeconds: number) => {
  const now = Math.floor(Date.now() / 1000);
  const body: SignedState<T> = { payload, iat: now, exp: now + ttlSeconds };
  const bodyB64 = base64url.encode(JSON.stringify(body));
  const sig = hmacSha256Hex(secret, bodyB64);
  return `${sig}.${bodyB64}`;
};

export const verifyState = <T>(secret: string, state: string): SignedState<T> => {
  const [sig, bodyB64] = state.split('.', 2);
  if (!sig || !bodyB64) throw new Error('Invalid state format');
  const expected = hmacSha256Hex(secret, bodyB64);
  if (!timingSafeEqualStr(sig, expected)) throw new Error('Invalid state signature');
  const decoded = JSON.parse(base64url.decode(bodyB64).toString('utf8')) as SignedState<T>;
  const now = Math.floor(Date.now() / 1000);
  if (decoded.exp < now) throw new Error('State expired');
  return decoded;
};
