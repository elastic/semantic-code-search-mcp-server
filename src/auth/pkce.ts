/**
 * PKCE verification for the OAuth authorization code flow.
 *
 * The `/oauth/token` endpoint verifies `code_verifier` against the stored `code_challenge` before
 * minting access/refresh tokens.
 */
import { sha256Base64url } from './crypto';

export const verifyPkceS256 = (codeVerifier: string, codeChallenge: string) => {
  const computed = sha256Base64url(codeVerifier);
  return computed === codeChallenge;
};
