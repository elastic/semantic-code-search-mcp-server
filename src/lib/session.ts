import { Request, Response } from 'express';
import * as jose from 'jose';
import { oidcConfig } from '../config';
import type { TokenClaims } from './oidc';

export type SessionUser = TokenClaims;

export interface Session {
  user: SessionUser;
  accessToken: string;
  expiresAt: number;
}

// In-memory session store (for simplicity - use Redis in production)
const sessions = new Map<string, Session>();

// PKCE state store (temporary, cleaned up after use)
interface PKCEData {
  verifier: string;
  redirectUri: string;
  nonce: string;
}
const pkceStore = new Map<string, PKCEData>();

// OAuth state store for Dynamic Client Registration flow
export interface OAuthStateData {
  clientId: string;
  redirectUri: string;
  originalState: string;
}
const oauthStateStore = new Map<string, OAuthStateData>();

/**
 * Create a session token (JWT) for the user
 */
export async function createSessionToken(user: SessionUser, accessToken: string, expiresIn: number): Promise<string> {
  const secret = new TextEncoder().encode(oidcConfig.cookieSecret || 'default-secret-change-me');

  const sessionId = crypto.randomUUID();
  const expiresAt = Date.now() + expiresIn * 1000;

  // Store session
  sessions.set(sessionId, {
    user,
    accessToken,
    expiresAt,
  });

  // Create JWT session token
  const token = await new jose.SignJWT({ sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt / 1000))
    .sign(secret);

  return token;
}

/**
 * Validate session token and return session
 */
export async function getSession(req: Request): Promise<Session | null> {
  const token = req.cookies?.session;
  if (!token) {
    return null;
  }

  try {
    const secret = new TextEncoder().encode(oidcConfig.cookieSecret || 'default-secret-change-me');
    const { payload } = await jose.jwtVerify(token, secret);
    const sessionId = payload.sessionId as string;

    const session = sessions.get(sessionId);
    if (!session) {
      return null;
    }

    // Check if expired
    if (Date.now() > session.expiresAt) {
      sessions.delete(sessionId);
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

/**
 * Set session cookie
 */
export function setSessionCookie(res: Response, token: string): void {
  res.cookie('session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  });
}

/**
 * Clear session cookie
 */
export function clearSessionCookie(res: Response): void {
  res.clearCookie('session');
}

/**
 * Store PKCE data for OAuth flow
 */
export async function storePKCE(state: string, verifier: string, redirectUri: string, nonce: string): Promise<void> {
  pkceStore.set(state, { verifier, redirectUri, nonce });

  // Auto-cleanup after 10 minutes
  setTimeout(() => pkceStore.delete(state), 10 * 60 * 1000);
}

/**
 * Retrieve and delete PKCE data
 */
export async function retrievePKCE(state: string): Promise<PKCEData | null> {
  const data = pkceStore.get(state);
  if (data) {
    pkceStore.delete(state);
  }
  return data || null;
}

/**
 * Store OAuth state for Dynamic Client Registration flow
 */
export async function storeOAuthState(state: string, data: OAuthStateData): Promise<void> {
  oauthStateStore.set(state, data);
  setTimeout(() => oauthStateStore.delete(state), 10 * 60 * 1000);
}

/**
 * Retrieve and delete OAuth state for Dynamic Client Registration flow
 */
export async function retrieveOAuthState(state: string): Promise<OAuthStateData | null> {
  const data = oauthStateStore.get(state);
  if (data) {
    oauthStateStore.delete(state);
  }
  return data || null;
}
