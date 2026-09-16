/** مسارات المصادقة / authentication routes. */
import {
  zGuestBody,
  zLoginBody,
  zRefreshBody,
  zRegisterBody,
  zUpgradeBody,
} from '@duskfront/shared';
import type { FastifyInstance } from 'fastify';
import type { Env } from '../env.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import {
  generateRefreshToken,
  hashToken,
  refreshExpiry,
  signAccessToken,
} from '../auth/tokens.js';
import type { Store } from '../persistence/types.js';
import { createLogger } from '../logger.js';

const log = createLogger('auth');

const GUEST_ADJECTIVES = ['غسقي', 'شمسي', 'قمري', 'رمادي', 'بلوري', 'ظلّي', 'فجري', 'ليلي'];

function randomGuestName(): string {
  const adjective = GUEST_ADJECTIVES[Math.floor(Math.random() * GUEST_ADJECTIVES.length)]!;
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `ضيف ${adjective} ${digits}`;
}

async function uniqueDisplayName(store: Store, preferred?: string): Promise<string> {
  let candidate = preferred ?? randomGuestName();
  for (let attempt = 0; attempt < 12; attempt++) {
    const taken = await store.findProfileByDisplayName(candidate);
    if (!taken) return candidate;
    candidate = `${(preferred ?? randomGuestName()).slice(0, 14)}${Math.floor(Math.random() * 999)}`;
  }
  return `${Date.now().toString(36)}`;
}

export async function registerAuthRoutes(app: FastifyInstance, env: Env, store: Store): Promise<void> {
  /** يصدر زوج رموز جديد ويخزّن تجزئة رمز التحديث. */
  async function issueTokens(userId: string, isGuest: boolean, displayName: string, device: string | null) {
    const accessToken = await signAccessToken(env, { sub: userId, isGuest, displayName });
    const refreshToken = generateRefreshToken();
    const expiresAt = refreshExpiry(env);
    await store.storeRefreshToken(userId, hashToken(refreshToken), expiresAt, device);
    return { accessToken, refreshToken, expiresAt: expiresAt.toISOString() };
  }

  app.post('/auth/guest', async (request, reply) => {
    const parsed = zGuestBody.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const displayName = await uniqueDisplayName(store, parsed.data.displayName);
    const { user, profile } = await store.createUser({
      email: null,
      passwordHash: null,
      isGuest: true,
      displayName,
      locale: parsed.data.locale,
    });
    const tokens = await issueTokens(user.id, true, profile.displayName, deviceOf(request.headers['user-agent']));
    log.info('guest created', { userId: user.id });
    return reply.code(201).send({ ...tokens, profile });
  });

  app.post('/auth/register', async (request, reply) => {
    const parsed = zRegisterBody.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const existing = await store.findUserByEmail(parsed.data.email);
    if (existing) return reply.code(409).send({ error: 'email_taken' });
    const displayName = await uniqueDisplayName(store, parsed.data.displayName);
    const { user, profile } = await store.createUser({
      email: parsed.data.email,
      passwordHash: await hashPassword(parsed.data.password),
      isGuest: false,
      displayName,
      locale: parsed.data.locale,
    });
    const tokens = await issueTokens(user.id, false, profile.displayName, deviceOf(request.headers['user-agent']));
    return reply.code(201).send({ ...tokens, profile });
  });

  app.post('/auth/login', async (request, reply) => {
    const parsed = zLoginBody.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    const user = await store.findUserByEmail(parsed.data.email);
    // نفس الرد ونفس الزمن تقريبًا سواء وُجد الحساب أو لا
    if (!user || !user.passwordHash) {
      await hashPassword(parsed.data.password);
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    if (user.bannedUntil && user.bannedUntil.getTime() > Date.now()) {
      return reply.code(403).send({ error: 'banned', until: user.bannedUntil.toISOString() });
    }
    const ok = await verifyPassword(user.passwordHash, parsed.data.password);
    if (!ok) return reply.code(401).send({ error: 'invalid_credentials' });
    await store.touchLogin(user.id);
    const profile = await store.getProfile(user.id);
    const tokens = await issueTokens(user.id, user.isGuest, profile?.displayName ?? '', deviceOf(request.headers['user-agent']));
    return reply.send({ ...tokens, profile });
  });

  app.post('/auth/refresh', async (request, reply) => {
    const parsed = zRefreshBody.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    const record = await store.findRefreshToken(hashToken(parsed.data.refreshToken));
    if (!record) return reply.code(401).send({ error: 'invalid_refresh_token' });
    if (record.revokedAt) {
      // إعادة استخدام رمز مُبطَل = تسريب محتمل: أبطل كل الجلسات
      await store.revokeAllRefreshTokens(record.userId);
      log.warn('refresh token reuse detected', { userId: record.userId });
      return reply.code(401).send({ error: 'token_reused' });
    }
    if (record.expiresAt.getTime() < Date.now()) {
      await store.revokeRefreshToken(record.id);
      return reply.code(401).send({ error: 'expired_refresh_token' });
    }
    await store.revokeRefreshToken(record.id);
    const user = await store.findUserById(record.userId);
    if (!user) return reply.code(401).send({ error: 'unknown_user' });
    const profile = await store.getProfile(user.id);
    const tokens = await issueTokens(user.id, user.isGuest, profile?.displayName ?? '', deviceOf(request.headers['user-agent']));
    return reply.send({ ...tokens, profile });
  });

  app.post('/auth/logout', async (request, reply) => {
    const parsed = zRefreshBody.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(204).send();
    const record = await store.findRefreshToken(hashToken(parsed.data.refreshToken));
    if (record) await store.revokeRefreshToken(record.id);
    return reply.code(204).send();
  });

  app.post('/auth/upgrade', { preHandler: app.requireAuth }, async (request, reply) => {
    const parsed = zUpgradeBody.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const userId = request.userId!;
    const user = await store.findUserById(userId);
    if (!user) return reply.code(404).send({ error: 'unknown_user' });
    if (!user.isGuest) return reply.code(409).send({ error: 'already_full_account' });
    const clash = await store.findUserByEmail(parsed.data.email);
    if (clash) return reply.code(409).send({ error: 'email_taken' });
    // الترقية تحافظ على كل البيانات: نفس user.id، نفس التقدّم والمخزون
    const upgraded = await store.upgradeGuest(userId, parsed.data.email, await hashPassword(parsed.data.password));
    const profile = await store.getProfile(userId);
    const tokens = await issueTokens(upgraded.id, false, profile?.displayName ?? '', deviceOf(request.headers['user-agent']));
    return reply.send({ ...tokens, profile });
  });
}

function deviceOf(userAgent: string | undefined): string | null {
  if (!userAgent) return null;
  return userAgent.slice(0, 190);
}
