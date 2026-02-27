/**
 * OAuth Authorization Endpoint (+ upstream OIDC login + consent UI).
 *
 * Handles `/oauth/authorize` requests from MCP clients, ensures the user is authenticated via an
 * external OIDC provider, records consent, and issues short-lived authorization codes to be exchanged
 * at `/oauth/token`.
 */
import { randomUUID } from 'crypto';
import type { Request, Response, Router } from 'express';

import type { OAuthConfig } from '../../config';
import { derive32ByteKey, encryptAes256Gcm, randomToken } from '../crypto';
import { parseCookies, serializeCookie } from '../cookies';
import { signState, verifyState } from '../state';
import type { OAuthStorage } from '../storage';
import { getOidcClient } from '../oidc';

const getOidc = async () => (await import('openid-client')) as typeof import('openid-client');

type ClientOAuthRequest = {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  scope?: string;
  state?: string;
  code_challenge: string;
  code_challenge_method?: string;
  resource?: string;
};

type OidcStatePayload = {
  txId: string;
  oauth: ClientOAuthRequest;
};

type ConsentStatePayload = {
  oauth: ClientOAuthRequest;
};

type SessionCookiePayload = {
  sessionId: string;
};

type ApprovalCookiePayload = {
  approvedClientIds: string[];
};

const SESSION_COOKIE = 'scsi_session';
const APPROVAL_COOKIE = 'mcp-approved-clients';

const AUTH_CODE_TTL_MS = 10 * 60 * 1000;
const OIDC_STATE_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const APPROVAL_TTL_SECONDS = 365 * 24 * 60 * 60;

const setNoCORS = (res: Response) => {
  // Intentional: do not reflect Origin on OAuth endpoints.
  res.removeHeader('Access-Control-Allow-Origin');
};

const isHttps = (cfg: OAuthConfig) => cfg.oauthServerUrl.startsWith('https://');

const getApprovedClientIds = (cfg: OAuthConfig, req: Request): string[] => {
  const cookies = parseCookies(req);
  const raw = cookies[APPROVAL_COOKIE];
  if (!raw) return [];
  try {
    const verified = verifyState<ApprovalCookiePayload>(cfg.oidcCookieSecret, raw);
    return Array.isArray(verified.payload.approvedClientIds) ? verified.payload.approvedClientIds : [];
  } catch {
    return [];
  }
};

const setApprovalCookie = (cfg: OAuthConfig, res: Response, approvedClientIds: string[]) => {
  const value = signState(cfg.oidcCookieSecret, { approvedClientIds }, APPROVAL_TTL_SECONDS);
  res.setHeader(
    'Set-Cookie',
    serializeCookie(APPROVAL_COOKIE, value, {
      httpOnly: true,
      secure: isHttps(cfg),
      sameSite: 'Lax',
      path: '/',
      maxAgeSeconds: APPROVAL_TTL_SECONDS,
    })
  );
};

const getSessionId = async (cfg: OAuthConfig, storage: OAuthStorage, req: Request) => {
  const cookies = parseCookies(req);
  const raw = cookies[SESSION_COOKIE];
  if (!raw) return null;
  try {
    const verified = verifyState<SessionCookiePayload>(cfg.oidcCookieSecret, raw);
    const sessionId = verified.payload.sessionId;
    if (!sessionId) return null;
    const session = await storage.getUserSession(sessionId);
    if (!session) return null;
    return sessionId;
  } catch {
    return null;
  }
};

const renderConsent = (cfg: OAuthConfig, res: Response, oauthReq: ClientOAuthRequest, clientName?: string) => {
  const consentState = signState<ConsentStatePayload>(
    cfg.oidcCookieSecret,
    { oauth: oauthReq },
    OIDC_STATE_TTL_SECONDS
  );
  const name = clientName || oauthReq.client_id;
  const scope = oauthReq.scope || 'mcp:read';
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Authorize MCP Client</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; background: #0b0f1a; color: #e6eaf2; margin: 0; padding: 24px; }
      .card { max-width: 520px; margin: 40px auto; background: #121a2a; border: 1px solid #223055; border-radius: 14px; padding: 20px; }
      h1 { font-size: 18px; margin: 0 0 8px; }
      p { margin: 6px 0; color: #b7c0d6; line-height: 1.4; }
      .client { font-weight: 600; color: #ffffff; }
      .scope { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; background: #0b1222; border: 1px solid #223055; padding: 6px 10px; border-radius: 10px; display: inline-block; margin-top: 6px; }
      .row { display: flex; gap: 10px; margin-top: 16px; }
      button { flex: 1; border-radius: 10px; padding: 10px 12px; font-weight: 600; border: 1px solid transparent; cursor: pointer; }
      .allow { background: #4f7cff; color: #081022; }
      .deny { background: transparent; color: #e6eaf2; border-color: #2b3b66; }
      .fineprint { font-size: 12px; color: #8e9ab6; margin-top: 14px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Allow access?</h1>
      <p><span class="client">${escapeHtml(name)}</span> wants to access this MCP server.</p>
      <div class="scope">${escapeHtml(scope)}</div>
      <form method="post" action="/oauth/consent">
        <input type="hidden" name="consent_state" value="${escapeAttr(consentState)}" />
        <div class="row">
          <button class="deny" type="submit" name="decision" value="deny">Deny</button>
          <button class="allow" type="submit" name="decision" value="approve">Allow</button>
        </div>
      </form>
      <div class="fineprint">You should only allow clients you trust. Your approval is remembered in this browser.</div>
    </div>
  </body>
</html>`;
  res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(html);
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escapeAttr = (s: string) => escapeHtml(s).replace(/'/g, '&#39;');

const redirectWithError = (res: Response, oauthReq: ClientOAuthRequest, error: string, desc?: string) => {
  const u = new URL(oauthReq.redirect_uri);
  u.searchParams.set('error', error);
  if (desc) u.searchParams.set('error_description', desc);
  if (oauthReq.state) u.searchParams.set('state', oauthReq.state);
  res.redirect(u.toString());
};

const issueAuthCodeAndRedirect = async (
  cfg: OAuthConfig,
  storage: OAuthStorage,
  res: Response,
  oauthReq: ClientOAuthRequest,
  userClaims: Record<string, unknown>
) => {
  const code = randomToken(32);
  await storage.putAuthCode({
    code,
    clientId: oauthReq.client_id,
    redirectUri: oauthReq.redirect_uri,
    codeChallenge: oauthReq.code_challenge,
    codeChallengeMethod: 'S256',
    scope: oauthReq.scope || 'mcp:read',
    resource: oauthReq.resource,
    userClaims,
    expiresAtMs: Date.now() + AUTH_CODE_TTL_MS,
  });

  const u = new URL(oauthReq.redirect_uri);
  u.searchParams.set('code', code);
  if (oauthReq.state) u.searchParams.set('state', oauthReq.state);
  res.redirect(u.toString());
};

const normalizeOauthReq = (req: Request): ClientOAuthRequest | null => {
  const q = req.query as Record<string, unknown>;
  const get = (k: string) => (typeof q[k] === 'string' ? (q[k] as string) : undefined);
  const response_type = get('response_type') || '';
  const client_id = get('client_id') || '';
  const redirect_uri = get('redirect_uri') || '';
  const scope = get('scope');
  const state = get('state');
  const code_challenge = get('code_challenge') || '';
  const code_challenge_method = get('code_challenge_method');
  const resource = get('resource');

  if (!client_id || !redirect_uri || !code_challenge) return null;
  return {
    response_type,
    client_id,
    redirect_uri,
    scope,
    state,
    code_challenge,
    code_challenge_method,
    resource,
  };
};

const validateClientRequest = async (storage: OAuthStorage, oauthReq: ClientOAuthRequest) => {
  if (oauthReq.response_type && oauthReq.response_type !== 'code') {
    return { ok: false as const, error: 'unsupported_response_type', desc: 'Only response_type=code is supported' };
  }
  if (oauthReq.code_challenge_method && oauthReq.code_challenge_method !== 'S256') {
    return { ok: false as const, error: 'invalid_request', desc: 'Only code_challenge_method=S256 is supported' };
  }

  const client = await storage.getClient(oauthReq.client_id);
  if (!client) return { ok: false as const, error: 'unauthorized_client', desc: 'Unknown client_id' };
  if (!client.redirectUris.includes(oauthReq.redirect_uri)) {
    return { ok: false as const, error: 'invalid_request', desc: 'redirect_uri does not match registered value' };
  }
  return { ok: true as const, client };
};

export const registerAuthorizeRoutes = (router: Router, cfg: OAuthConfig, storage: OAuthStorage) => {
  router.get('/oauth/authorize', async (req: Request, res: Response) => {
    setNoCORS(res);
    const oauthReq = normalizeOauthReq(req);
    if (!oauthReq) {
      res.status(400).send('Invalid authorization request');
      return;
    }

    const validation = await validateClientRequest(storage, oauthReq);
    if (!validation.ok) {
      redirectWithError(res, oauthReq, validation.error, validation.desc);
      return;
    }

    const sessionId = await getSessionId(cfg, storage, req);
    if (!sessionId) {
      const txId = randomUUID();
      // Upstream OIDC auth uses PKCE + nonce.
      const oidc = await getOidc();
      const codeVerifier = oidc.randomPKCECodeVerifier();
      const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
      const nonce = oidc.randomNonce();

      await storage.putOidcTx({
        txId,
        codeVerifier,
        nonce,
        createdAtMs: Date.now(),
        expiresAtMs: Date.now() + 10 * 60 * 1000,
      });
      const signedState = signState<OidcStatePayload>(
        cfg.oidcCookieSecret,
        { txId, oauth: oauthReq },
        OIDC_STATE_TTL_SECONDS
      );
      const { config, redirectUri } = await getOidcClient(cfg);
      const redirectTo = oidc.buildAuthorizationUrl(config, {
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: 'openid profile email offline_access',
        state: signedState,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });
      res.redirect(redirectTo.toString());
      return;
    }

    const session = await storage.getUserSession(sessionId);
    if (!session) {
      res.status(401).send('Not authenticated');
      return;
    }

    const approved = new Set(getApprovedClientIds(cfg, req));
    if (!approved.has(oauthReq.client_id)) {
      renderConsent(cfg, res, oauthReq, validation.client.clientName);
      return;
    }

    await issueAuthCodeAndRedirect(cfg, storage, res, oauthReq, session.userClaims);
  });

  router.post('/oauth/consent', async (req: Request, res: Response) => {
    setNoCORS(res);
    const decision = typeof req.body?.decision === 'string' ? (req.body.decision as string) : '';
    const consentStateRaw = typeof req.body?.consent_state === 'string' ? (req.body.consent_state as string) : '';
    if (!consentStateRaw) {
      res.status(400).send('Missing consent_state');
      return;
    }

    let oauthReq: ClientOAuthRequest;
    try {
      const verified = verifyState<ConsentStatePayload>(cfg.oidcCookieSecret, consentStateRaw);
      oauthReq = verified.payload.oauth;
    } catch {
      res.status(400).send('Invalid consent_state');
      return;
    }

    const validation = await validateClientRequest(storage, oauthReq);
    if (!validation.ok) {
      redirectWithError(res, oauthReq, validation.error, validation.desc);
      return;
    }

    const sessionId = await getSessionId(cfg, storage, req);
    if (!sessionId) {
      redirectWithError(res, oauthReq, 'login_required', 'No active session');
      return;
    }
    const session = await storage.getUserSession(sessionId);
    if (!session) {
      redirectWithError(res, oauthReq, 'login_required', 'No active session');
      return;
    }

    if (decision !== 'approve') {
      redirectWithError(res, oauthReq, 'access_denied', 'User denied access');
      return;
    }

    const approved = new Set(getApprovedClientIds(cfg, req));
    approved.add(oauthReq.client_id);
    setApprovalCookie(cfg, res, [...approved]);

    await issueAuthCodeAndRedirect(cfg, storage, res, oauthReq, session.userClaims);
  });

  router.get('/oauth/callback', async (req: Request, res: Response) => {
    setNoCORS(res);
    const params = req.query as Record<string, unknown>;
    const code = typeof params.code === 'string' ? (params.code as string) : '';
    const state = typeof params.state === 'string' ? (params.state as string) : '';
    if (!code || !state) {
      res.status(400).send('Missing code or state');
      return;
    }

    let verified: { payload: OidcStatePayload };
    try {
      verified = verifyState<OidcStatePayload>(cfg.oidcCookieSecret, state);
    } catch {
      res.status(400).send('Invalid state');
      return;
    }

    const tx = await storage.consumeOidcTx(verified.payload.txId);
    if (!tx) {
      res.status(400).send('Invalid or expired transaction');
      return;
    }

    const oauthReq = verified.payload.oauth;
    const validation = await validateClientRequest(storage, oauthReq);
    if (!validation.ok) {
      redirectWithError(res, oauthReq, validation.error, validation.desc);
      return;
    }

    const { config } = await getOidcClient(cfg);
    const oidc = await getOidc();
    let tokens: Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>;
    try {
      const currentUrl = new URL(`${cfg.oauthServerUrl}${req.originalUrl}`);
      tokens = await oidc.authorizationCodeGrant(
        config,
        currentUrl,
        {
          pkceCodeVerifier: tx.codeVerifier,
          expectedState: state,
          expectedNonce: tx.nonce,
        },
        {
          // ensure refresh token from upstream if supported
          scope: 'openid profile email offline_access',
        }
      );
    } catch {
      res.status(400).send('OIDC callback failed');
      return;
    }

    const idClaims = (tokens.claims?.() ?? {}) as Record<string, unknown>;
    let userinfo: Record<string, unknown> = {};
    try {
      if (typeof tokens.access_token === 'string') {
        const sub = typeof idClaims.sub === 'string' ? idClaims.sub : '';
        if (sub) {
          userinfo = (await oidc.fetchUserInfo(config, tokens.access_token, sub)) as Record<string, unknown>;
        }
      }
    } catch {
      userinfo = {};
    }

    const userClaims = { ...userinfo, ...idClaims };
    for (const claim of cfg.oidcRequiredClaims) {
      if (userClaims[claim] == null) {
        res.status(403).send(`Missing required claim: ${claim}`);
        return;
      }
    }

    const sessionId = randomUUID();
    const upstreamRefreshToken = typeof tokens.refresh_token === 'string' ? tokens.refresh_token : undefined;
    const upstreamRefreshTokenEnc = upstreamRefreshToken
      ? encryptAes256Gcm(derive32ByteKey(cfg.oidcCookieSecret), upstreamRefreshToken)
      : undefined;

    await storage.putUserSession({
      sessionId,
      userClaims,
      upstreamRefreshTokenEnc,
      createdAtMs: Date.now(),
      expiresAtMs: Date.now() + SESSION_TTL_SECONDS * 1000,
    });

    const sessionCookieVal = signState<SessionCookiePayload>(cfg.oidcCookieSecret, { sessionId }, SESSION_TTL_SECONDS);
    res.setHeader(
      'Set-Cookie',
      serializeCookie(SESSION_COOKIE, sessionCookieVal, {
        httpOnly: true,
        secure: isHttps(cfg),
        sameSite: 'Lax',
        path: '/',
        maxAgeSeconds: SESSION_TTL_SECONDS,
      })
    );

    const approved = new Set(getApprovedClientIds(cfg, req));
    if (!approved.has(oauthReq.client_id)) {
      renderConsent(cfg, res, oauthReq, validation.client.clientName);
      return;
    }

    await issueAuthCodeAndRedirect(cfg, storage, res, oauthReq, userClaims);
  });
};
