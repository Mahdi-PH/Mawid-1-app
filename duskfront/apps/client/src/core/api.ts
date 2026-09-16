/**
 * عميل REST: يحمل رمز الوصول، ويجدّده تلقائيًا عند انتهائه، ويوحّد شكل الأخطاء.
 * REST client with transparent access-token refresh and a single error shape.
 */
import type { CampaignSaveDto, PlayerSettingsBundle } from '@duskfront/shared';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:2567';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export interface ProfileDto {
  userId: string;
  displayName: string;
  avatarId: string;
  level: number;
  xp: number;
  shards: number;
  rankRating: number;
  locale: string;
  xpIntoLevel?: number;
  xpForNext?: number;
  isGuest?: boolean;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(`${status}:${code}`);
    this.name = 'ApiError';
  }
}

export class ApiClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private refreshInFlight: Promise<boolean> | null = null;
  private onTokensChanged: ((tokens: AuthTokens | null) => void) | null = null;

  get baseUrl(): string {
    return API_BASE;
  }

  get isAuthenticated(): boolean {
    return this.accessToken !== null;
  }

  setTokens(tokens: AuthTokens | null): void {
    this.accessToken = tokens?.accessToken ?? null;
    this.refreshToken = tokens?.refreshToken ?? null;
    this.onTokensChanged?.(tokens);
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  observeTokens(listener: (tokens: AuthTokens | null) => void): void {
    this.onTokensChanged = listener;
  }

  /** طلب عام مع إعادة محاولة واحدة بعد تجديد الرمز. */
  async request<T>(path: string, init: RequestInit = {}, retryOnAuthFailure = true): Promise<T> {
    const headers = new Headers(init.headers);
    if (!headers.has('content-type') && init.body) headers.set('content-type', 'application/json');
    if (this.accessToken) headers.set('authorization', `Bearer ${this.accessToken}`);

    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, { ...init, headers });
    } catch (error) {
      throw new ApiError(0, 'network_error', error);
    }

    if (response.status === 401 && retryOnAuthFailure && this.refreshToken) {
      const refreshed = await this.refresh();
      if (refreshed) return this.request<T>(path, init, false);
    }

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    const payload = text ? (JSON.parse(text) as unknown) : null;
    if (!response.ok) {
      const code = (payload as { error?: string } | null)?.error ?? 'request_failed';
      throw new ApiError(response.status, code, payload);
    }
    return payload as T;
  }

  private async refresh(): Promise<boolean> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = (async () => {
      try {
        const response = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken: this.refreshToken }),
        });
        if (!response.ok) {
          this.setTokens(null);
          return false;
        }
        const data = (await response.json()) as AuthTokens & { profile: ProfileDto };
        this.setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken, expiresAt: data.expiresAt });
        return true;
      } catch {
        return false;
      } finally {
        this.refreshInFlight = null;
      }
    })();
    return this.refreshInFlight;
  }

  // ───────────────────────────── المصادقة ───────────────────────────────────

  async guest(locale: string, displayName?: string): Promise<{ tokens: AuthTokens; profile: ProfileDto }> {
    const data = await this.request<AuthTokens & { profile: ProfileDto }>('/auth/guest', {
      method: 'POST',
      body: JSON.stringify({ locale, displayName }),
    });
    const tokens = { accessToken: data.accessToken, refreshToken: data.refreshToken, expiresAt: data.expiresAt };
    this.setTokens(tokens);
    return { tokens, profile: data.profile };
  }

  async register(email: string, password: string, locale: string, displayName?: string) {
    const data = await this.request<AuthTokens & { profile: ProfileDto }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, locale, displayName }),
    });
    const tokens = { accessToken: data.accessToken, refreshToken: data.refreshToken, expiresAt: data.expiresAt };
    this.setTokens(tokens);
    return { tokens, profile: data.profile };
  }

  async login(email: string, password: string) {
    const data = await this.request<AuthTokens & { profile: ProfileDto }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    const tokens = { accessToken: data.accessToken, refreshToken: data.refreshToken, expiresAt: data.expiresAt };
    this.setTokens(tokens);
    return { tokens, profile: data.profile };
  }

  async upgrade(email: string, password: string) {
    const data = await this.request<AuthTokens & { profile: ProfileDto }>('/auth/upgrade', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    const tokens = { accessToken: data.accessToken, refreshToken: data.refreshToken, expiresAt: data.expiresAt };
    this.setTokens(tokens);
    return { tokens, profile: data.profile };
  }

  async logout(): Promise<void> {
    if (this.refreshToken) {
      await this.request('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      }).catch(() => undefined);
    }
    this.setTokens(null);
  }

  // ───────────────────────────── اللاعب ─────────────────────────────────────

  getProfile(): Promise<ProfileDto> {
    return this.request<ProfileDto>('/me/profile');
  }

  patchProfile(patch: { displayName?: string; avatarId?: string; locale?: string }): Promise<ProfileDto> {
    return this.request<ProfileDto>('/me/profile', { method: 'PATCH', body: JSON.stringify(patch) });
  }

  getSettings(): Promise<PlayerSettingsBundle> {
    return this.request<PlayerSettingsBundle>('/me/settings');
  }

  putSettings(settings: PlayerSettingsBundle): Promise<{ ok: boolean }> {
    return this.request('/me/settings', { method: 'PUT', body: JSON.stringify(settings) });
  }

  getStats(): Promise<Record<string, number | string | null>> {
    return this.request('/me/stats');
  }

  getInventory(): Promise<{ owned: CatalogItemDto[]; catalog: (CatalogItemDto & { owned: boolean })[] }> {
    return this.request('/me/inventory');
  }

  buy(itemKey: string): Promise<{ ok: boolean; shards: number }> {
    return this.request(`/shop/buy/${encodeURIComponent(itemKey)}`, { method: 'POST' });
  }

  getMissions(): Promise<{ day: string; resetsInSec: number; missions: MissionDto[] }> {
    return this.request('/me/missions');
  }

  claimMission(id: string): Promise<{ ok: boolean; xp: number; shards: number }> {
    return this.request(`/me/missions/${encodeURIComponent(id)}/claim`, { method: 'POST' });
  }

  getAchievements(): Promise<{ achievements: AchievementDto[]; total: number }> {
    return this.request('/me/achievements');
  }

  getLoadouts(classKey: string): Promise<{ classKey: string; loadouts: LoadoutDto[] }> {
    return this.request(`/me/loadouts/${encodeURIComponent(classKey)}`);
  }

  putLoadout(classKey: string, slot: number, config: Record<string, unknown>): Promise<{ ok: boolean }> {
    return this.request(`/me/loadouts/${encodeURIComponent(classKey)}`, {
      method: 'PUT',
      body: JSON.stringify({ slot, config }),
    });
  }

  getLeaderboard(mode: string, page: number): Promise<{ rows: LeaderboardRowDto[]; total: number; page: number }> {
    return this.request(`/leaderboard?mode=${encodeURIComponent(mode)}&page=${page}`);
  }

  getFriends(): Promise<{ friends: FriendDto[] }> {
    return this.request('/friends');
  }

  addFriend(friendId: string): Promise<{ ok: boolean }> {
    return this.request('/friends', { method: 'POST', body: JSON.stringify({ friendId }) });
  }

  removeFriend(friendId: string): Promise<void> {
    return this.request(`/friends/${encodeURIComponent(friendId)}`, { method: 'DELETE' });
  }

  report(reportedId: string, reason: string, matchId: string | null, details?: string): Promise<{ ok: boolean }> {
    return this.request('/reports', {
      method: 'POST',
      body: JSON.stringify({ reportedId, reason, matchId, details }),
    });
  }

  // ───────────────────────────── الحفظ ──────────────────────────────────────

  listSaves(): Promise<{ slots: number; saves: CampaignSaveDto[] }> {
    return this.request('/me/saves');
  }

  getSave(slot: number): Promise<CampaignSaveDto> {
    return this.request(`/me/saves/${slot}`);
  }

  putSave(slot: number, body: Omit<CampaignSaveDto, 'slot' | 'updatedAt'>): Promise<CampaignSaveDto> {
    return this.request(`/me/saves/${slot}`, { method: 'PUT', body: JSON.stringify(body) });
  }

  deleteSave(slot: number): Promise<void> {
    return this.request(`/me/saves/${slot}`, { method: 'DELETE' });
  }

  exportData(): Promise<Record<string, unknown>> {
    return this.request('/me/export');
  }

  deleteAccount(): Promise<void> {
    return this.request('/me', { method: 'DELETE' });
  }

  // ───────────────────────────── المطابقة ──────────────────────────────────

  queue(body: {
    mode: string;
    classKey: string;
    difficulty?: string;
    soloVsBots?: boolean;
    pingMs?: number;
  }): Promise<QueueResponse> {
    return this.request('/api/queue', { method: 'POST', body: JSON.stringify(body) });
  }

  health(): Promise<{ ok: boolean; version: string; store: string; cache: string }> {
    return this.request('/health');
  }
}

export interface QueueResponse {
  local: boolean;
  mode?: string;
  roomName?: string;
  joinOptions?: Record<string, unknown>;
  rating?: number;
  botFillAfterSec?: number;
  mapKey?: string;
  seed?: number;
}

export interface CatalogItemDto {
  id: string;
  key: string;
  type: string;
  classKey: string | null;
  priceShards: number;
  rarity: string;
  nameKeyAr: string;
  nameKeyEn: string;
  colorPrimary: string;
  colorAccent: string;
}

export interface MissionDto {
  missionId: string;
  key: string;
  target: number;
  rewardXp: number;
  rewardShards: number;
  progress: number;
  claimed: boolean;
}

export interface AchievementDto {
  achievementId: string;
  key: string;
  target: number;
  rewardShards: number;
  progress: number;
  unlockedAt: string | null;
}

export interface LoadoutDto {
  classKey: string;
  slot: number;
  config: Record<string, unknown>;
}

export interface LeaderboardRowDto {
  userId: string;
  displayName: string;
  rankRating: number;
  level: number;
  wins: number;
  matchesPlayed: number;
}

export interface FriendDto {
  userId: string;
  displayName: string;
  status: 'pending' | 'accepted' | 'blocked';
  direction: 'outgoing' | 'incoming';
}
