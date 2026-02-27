/**
 * Minimal cookie parsing/serialization for the OAuth/OIDC browser flow.
 *
 * Used by `/oauth/authorize` + `/oauth/callback` to persist the user session id and remembered client
 * approvals in HttpOnly cookies (without pulling in an additional cookie parsing dependency).
 */
import type { Request } from 'express';

export const parseCookies = (req: Request) => {
  const header = req.headers.cookie;
  const out: Record<string, string> = {};
  if (!header) return out;
  const parts = header.split(';');
  for (const part of parts) {
    const [k, ...rest] = part.trim().split('=');
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join('=') || '');
  }
  return out;
};

export const serializeCookie = (
  name: string,
  value: string,
  opts: {
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Lax' | 'Strict' | 'None';
    path?: string;
    maxAgeSeconds?: number;
  }
) => {
  const segments: string[] = [];
  segments.push(`${name}=${encodeURIComponent(value)}`);
  segments.push(`Path=${opts.path ?? '/'}`);
  if (opts.httpOnly) segments.push('HttpOnly');
  if (opts.secure) segments.push('Secure');
  if (opts.sameSite) segments.push(`SameSite=${opts.sameSite}`);
  if (opts.maxAgeSeconds != null) segments.push(`Max-Age=${Math.floor(opts.maxAgeSeconds)}`);
  return segments.join('; ');
};
