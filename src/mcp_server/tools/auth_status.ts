import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

export const authStatusSchema = z.object({});

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}

type ToolExtra = { authInfo?: AuthInfo };

export function createAuthStatusHandler(issuer?: string) {
  return async (_args: Record<string, never>, extra: ToolExtra): Promise<CallToolResult> => {
    const auth = extra.authInfo;

    if (!auth) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ authenticated: false }, null, 2) }],
      };
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresInSeconds = auth.expiresAt != null ? auth.expiresAt - now : null;

    const info = {
      authenticated: true,
      issuer,
      clientId: auth.clientId,
      scopes: auth.scopes,
      expiresAt: auth.expiresAt != null ? new Date(auth.expiresAt * 1000).toISOString() : null,
      expiresIn:
        expiresInSeconds != null ? (expiresInSeconds > 0 ? formatDuration(expiresInSeconds) : 'expired') : null,
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(info, null, 2) }],
    };
  };
}
