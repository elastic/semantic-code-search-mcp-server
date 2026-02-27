/**
 * Per-request auth claims context.
 *
 * After bearer token validation, claims are stored in AsyncLocalStorage so lower-level code (tools,
 * storage, request handlers) can read the current subject/claims without threading parameters through
 * every call.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

import type { AccessTokenClaims } from './tokens';

type Store = {
  claims: AccessTokenClaims;
};

const als = new AsyncLocalStorage<Store>();

export const runWithAuthClaims = <T>(claims: AccessTokenClaims, fn: () => T) => {
  return als.run({ claims }, fn);
};

export const getAuthClaims = () => {
  return als.getStore()?.claims;
};
