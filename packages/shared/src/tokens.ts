import crypto from 'node:crypto';

export interface TokenPayload {
  [key: string]: unknown;
  exp?: number;
}

function toBase64Url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

function fromBase64Url(str: string): Buffer {
  return Buffer.from(str, 'base64url');
}

/**
 * Signs a payload dictionary using HMAC-SHA256.
 * Output format: base64url(payloadJson).base64url(hmac)
 */
export function signToken(payload: TokenPayload, secret: string): string {
  const json = JSON.stringify(payload);
  const encodedPayload = toBase64Url(Buffer.from(json, 'utf8'));

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(encodedPayload);
  const signature = toBase64Url(hmac.digest());

  return `${encodedPayload}.${signature}`;
}

/**
 * Verifies a signed HMAC-SHA256 token in constant time.
 * Returns the decoded payload if valid and unexpired; returns null otherwise.
 */
export function verifyToken<T extends TokenPayload = TokenPayload>(
  token: string,
  secret: string,
): T | null {
  if (!token || typeof token !== 'string') {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return null;
  }

  const encodedPayload = parts[0]!;
  const signature = parts[1]!;

  try {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(encodedPayload);
    const expectedSignature = toBase64Url(hmac.digest());

    const sigBuffer = fromBase64Url(signature);
    const expectedBuffer = fromBase64Url(expectedSignature);

    if (sigBuffer.length !== expectedBuffer.length) {
      return null;
    }

    if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      return null;
    }

    const payloadJson = fromBase64Url(encodedPayload).toString('utf8');
    const payload = JSON.parse(payloadJson) as T;

    if (payload.exp && typeof payload.exp === 'number') {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (nowSeconds > payload.exp) {
        return null;
      }
    }

    return payload;
  } catch {
    return null;
  }
}
