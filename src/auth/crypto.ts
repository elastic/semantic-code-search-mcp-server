/**
 * Crypto primitives used throughout the OAuth/OIDC flow.
 *
 * Provides base64url encoding, HMAC signing for state/cookies, token generation, timing-safe compares,
 * and encryption for storing upstream refresh tokens at rest (in session storage).
 */
import crypto from 'crypto';

export const base64url = {
  encode: (buf: Uint8Array | Buffer | string) => {
    const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : Buffer.from(buf);
    return b.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  },
  decode: (str: string) => {
    const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
    const s = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
    return Buffer.from(s, 'base64');
  },
};

export const hmacSha256Hex = (secret: string, data: string) => {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
};

export const sha256Base64url = (data: string) => {
  const digest = crypto.createHash('sha256').update(data).digest();
  return base64url.encode(digest);
};

export const randomToken = (bytes = 32) => {
  return base64url.encode(crypto.randomBytes(bytes));
};

export const timingSafeEqualStr = (a: string, b: string) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
};

export const derive32ByteKey = (secret: string) => {
  return crypto.createHash('sha256').update(secret).digest(); // 32 bytes
};

export const encryptAes256Gcm = (key32: Buffer, plaintext: string) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key32, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return base64url.encode(Buffer.concat([iv, tag, ciphertext]));
};

export const decryptAes256Gcm = (key32: Buffer, enc: string) => {
  const raw = base64url.decode(enc);
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key32, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
};
