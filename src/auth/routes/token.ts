/**
 * OAuth Token Endpoint.
 *
 * Exchanges authorization codes for access/refresh tokens and supports refresh token rotation.
 * Enforces PKCE and issues signed JWT access tokens used by `bearerAuth` to protect `/mcp`.
 */
import type { Request, Response, Router } from 'express';

import type { OAuthConfig } from '../../config';
import { randomToken } from '../crypto';
import { verifyPkceS256 } from '../pkce';
import type { OAuthStorage } from '../storage';
import { signAccessToken } from '../tokens';
import { hashRefreshToken } from '../token_utils';

const ACCESS_TOKEN_TTL_SECONDS = 8 * 60 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const LOCK_TTL_SECONDS = 5;

const setNoCORS = (res: Response) => {
  res.removeHeader('Access-Control-Allow-Origin');
};

const setNoStore = (res: Response) => {
  // RFC 6749 requires these headers on responses containing tokens/credentials.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
};

const jsonError = (res: Response, status: number, error: string, desc?: string) => {
  res.status(status).json({ error, ...(desc ? { error_description: desc } : {}) });
};

export const registerTokenRoutes = (router: Router, cfg: OAuthConfig, storage: OAuthStorage) => {
  router.post('/oauth/token', async (req: Request, res: Response) => {
    setNoCORS(res);
    setNoStore(res);
    const body = req.body as Record<string, unknown>;
    const grantType = typeof body.grant_type === 'string' ? (body.grant_type as string) : '';
    const clientId = typeof body.client_id === 'string' ? (body.client_id as string) : '';

    if (!grantType) {
      jsonError(res, 400, 'invalid_request', 'grant_type is required');
      return;
    }
    if (!clientId) {
      jsonError(res, 400, 'invalid_request', 'client_id is required');
      return;
    }

    const client = await storage.getClient(clientId);
    if (!client) {
      jsonError(res, 400, 'invalid_client', 'Unknown client_id');
      return;
    }

    if (client.tokenEndpointAuthMethod !== 'none') {
      jsonError(res, 400, 'invalid_client', 'Unsupported token_endpoint_auth_method');
      return;
    }

    if (grantType === 'authorization_code') {
      const code = typeof body.code === 'string' ? (body.code as string) : '';
      const redirectUri = typeof body.redirect_uri === 'string' ? (body.redirect_uri as string) : '';
      const codeVerifier = typeof body.code_verifier === 'string' ? (body.code_verifier as string) : '';

      if (!code || !redirectUri || !codeVerifier) {
        jsonError(res, 400, 'invalid_request', 'code, redirect_uri, and code_verifier are required');
        return;
      }

      if (!client.redirectUris.includes(redirectUri)) {
        jsonError(res, 400, 'invalid_grant', 'redirect_uri mismatch');
        return;
      }

      const record = await storage.consumeAuthCode(code);
      if (!record) {
        jsonError(res, 400, 'invalid_grant', 'Invalid or expired code');
        return;
      }
      if (record.clientId !== clientId || record.redirectUri !== redirectUri) {
        jsonError(res, 400, 'invalid_grant', 'Invalid code for this client');
        return;
      }
      if (record.codeChallengeMethod !== 'S256' || !verifyPkceS256(codeVerifier, record.codeChallenge)) {
        jsonError(res, 400, 'invalid_grant', 'PKCE verification failed');
        return;
      }

      const subject = String(record.userClaims.sub ?? '');
      if (!subject) {
        jsonError(res, 400, 'invalid_grant', 'Missing subject');
        return;
      }

      const accessToken = await signAccessToken({
        signingSecret: cfg.jwtSigningSecret,
        issuer: cfg.oauthServerUrl,
        audience: cfg.oauthServerUrl,
        subject,
        scope: record.scope,
        ttlSeconds: ACCESS_TOKEN_TTL_SECONDS,
        extraClaims: record.userClaims,
      });

      const refreshToken = randomToken(32);
      const refreshTokenHash = hashRefreshToken(cfg.jwtSigningSecret, refreshToken);
      const nowMs = Date.now();

      await storage.putRefreshToken({
        refreshTokenHash,
        clientId,
        scope: record.scope,
        resource: record.resource,
        userClaims: record.userClaims,
        createdAtMs: nowMs,
        expiresAtMs: nowMs + REFRESH_TOKEN_TTL_SECONDS * 1000,
      });

      res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        refresh_token: refreshToken,
        scope: record.scope,
      });
      return;
    }

    if (grantType === 'refresh_token') {
      const refreshToken = typeof body.refresh_token === 'string' ? (body.refresh_token as string) : '';
      if (!refreshToken) {
        jsonError(res, 400, 'invalid_request', 'refresh_token is required');
        return;
      }

      const oldHash = hashRefreshToken(cfg.jwtSigningSecret, refreshToken);
      const lockKey = `oauth:rtlock:${oldHash}`;
      const lockToken = await storage.acquireLock(lockKey, LOCK_TTL_SECONDS);
      if (!lockToken) {
        jsonError(res, 429, 'slow_down', 'Retry refresh');
        return;
      }

      try {
        const record = await storage.getRefreshTokenByHash(oldHash);
        if (!record) {
          jsonError(res, 400, 'invalid_grant', 'Invalid refresh_token');
          return;
        }
        if (record.clientId !== clientId) {
          jsonError(res, 400, 'invalid_grant', 'refresh_token client mismatch');
          return;
        }

        const subject = String(record.userClaims.sub ?? '');
        if (!subject) {
          jsonError(res, 400, 'invalid_grant', 'Missing subject');
          return;
        }

        const accessToken = await signAccessToken({
          signingSecret: cfg.jwtSigningSecret,
          issuer: cfg.oauthServerUrl,
          audience: cfg.oauthServerUrl,
          subject,
          scope: record.scope,
          ttlSeconds: ACCESS_TOKEN_TTL_SECONDS,
          extraClaims: record.userClaims,
        });

        const newRefreshToken = randomToken(32);
        const newHash = hashRefreshToken(cfg.jwtSigningSecret, newRefreshToken);
        const nowMs = Date.now();
        await storage.putRefreshToken({
          refreshTokenHash: newHash,
          clientId,
          scope: record.scope,
          resource: record.resource,
          userClaims: record.userClaims,
          createdAtMs: nowMs,
          expiresAtMs: nowMs + REFRESH_TOKEN_TTL_SECONDS * 1000,
        });
        await storage.deleteRefreshTokenByHash(oldHash);

        res.json({
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: ACCESS_TOKEN_TTL_SECONDS,
          refresh_token: newRefreshToken,
          scope: record.scope,
        });
      } finally {
        await storage.releaseLock(lockKey, lockToken);
      }
      return;
    }

    jsonError(res, 400, 'unsupported_grant_type', 'Only authorization_code and refresh_token are supported');
  });
};
