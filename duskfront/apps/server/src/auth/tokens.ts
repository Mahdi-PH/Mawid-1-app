/**
 * رموز الوصول والتحديث.
 * Access tokens are short-lived JWTs; refresh tokens are opaque random strings that are
 * stored only as SHA-256 hashes and rotated on every use (a replayed token revokes the
 * whole chain, which is the standard detection for a stolen refresh token).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { Env } from '../env.js';

export interface AccessClaims {
  sub: string;
  isGuest: boolean;
  displayName: string;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function signAccessToken(env: Env, claims: AccessClaims): Promise<string> {
  const secret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
  return new SignJWT({ isGuest: claims.isGuest, displayName: claims.displayName })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer('duskfront')
    .setAudience('duskfront-client')
    .setExpirationTime(env.ACCESS_TOKEN_TTL)
    .sign(secret);
}

export async function verifyAccessToken(env: Env, token: string): Promise<AccessClaims | null> {
  try {
    const secret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
    const { payload } = await jwtVerify(token, secret, {
      issuer: 'duskfront',
      audience: 'duskfront-client',
    });
    if (!payload.sub) return null;
    return {
      sub: payload.sub,
      isGuest: Boolean(payload.isGuest),
      displayName: String(payload.displayName ?? ''),
    };
  } catch {
    return null;
  }
}

export function refreshExpiry(env: Env): Date {
  return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}
