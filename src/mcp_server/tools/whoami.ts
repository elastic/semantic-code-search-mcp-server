import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types';

import { getAuthClaims } from '../../auth/request_context';

export const whoamiSchema = z.object({});

export async function whoami(): Promise<CallToolResult> {
  const claims = getAuthClaims();
  if (!claims) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              authenticated: false,
              reason: 'No HTTP auth context available (likely stdio transport or auth disabled).',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = typeof claims.exp === 'number' ? claims.exp : undefined;
  const iat = typeof claims.iat === 'number' ? claims.iat : undefined;

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            authenticated: true,
            subject: claims.sub,
            scope: claims.scope,
            issuer: claims.iss,
            audience: claims.aud,
            iat,
            exp,
            expires_in_seconds: exp ? Math.max(0, exp - now) : null,
          },
          null,
          2
        ),
      },
    ],
  };
}
