/**
 * القوائم: الرئيسية، الأوضاع، الصنف والتجهيز، الملف، الإحصاءات، الإنجازات،
 * المتجر، المهام، الأصدقاء، لوحة الصدارة، الإعدادات، وحفظ/تحميل الحملة.
 * Every menu the spec asks for, rendered over the live 3D scene so the world keeps
 * crawling behind the UI instead of freezing on a static background.
 */
import {
  CLASS_KEYS,
  balance,
  levelFromXp,
  type ClassKey,
  type Difficulty,
  type GameMode,
  type PlayerSettingsBundle,
} from '@duskfront/shared';
import type {
  AchievementDto,
  ApiClient,
  CatalogItemDto,
  FriendDto,
  LeaderboardRowDto,
  MissionDto,
  ProfileDto,
} from '../core/api.js';
import type { SettingsStore } from '../core/settings.js';
import { CAMPAIGN_MISSIONS, listSaveSlots } from '../game/campaign.js';
import { ACTIONS, describeKeyCode, type ActionName, type InputManager } from '../input/input.js';
import { formatDuration, formatNumber, getLocale, setLocale, t, type Locale } from '../i18n/index.js';

export type MenuPage =
  | 'home'
  | 'modes'
  | 'loadout'
  | 'campaign'
  | 'profile'
  | 'stats'
  | 'achievements'
  | 'shop'
  | 'missions'
  | 'friends'
  | 'leaderboard'
  | 'settings';

export interface MenuCallbacks {
  onStartMatch(mode: GameMode, classKey: ClassKey, options: { soloVsBots: boolean; difficulty: Difficulty }): void;
  onStartCampaign(slot: number, missionIndex: number, difficulty: Difficulty, classKey: ClassKey): void;
  onStartTutorial(): void;
  onLogout(): void;
  onLocaleChanged(locale: Locale): void;
  onSettingsChanged(): void;
  playUiSound(name: 'ui_click' | 'ui_hover'): void;
}

export class Menus {
  readonly root: HTMLElement;
  private readonly navContainer: HTMLElement;
  private readonly content: HTMLElement;
  private readonly toastStack: HTMLElement;
  private page: MenuPage = 'home';
  private profile: ProfileDto | null = null;
  private selectedClass: ClassKey = 'guardian';
  private selectedDifficulty: Difficulty = 'normal';
  private listeningFor: ActionName | null = null;

  constructor(
    parent: HTMLElement,
    private readonly api: ApiClient,
    private readonly settings: SettingsStore,
    private readonly input: InputManager,
    private readonly callbacks: MenuCallbacks,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'menu-layer';
    this.root.className = 'layer interactive';
    this.root.innerHTML = `
      <div class="menu-shell">
        <aside>
          <div class="menu-brand">
            <h1>DUSKFRONT</h1>
            <div class="sub">جبهة الغسق</div>
            <div class="tagline" data-ref="tagline"></div>
          </div>
          <nav class="menu-nav" data-ref="nav"></nav>
        </aside>
        <main class="menu-content panel" data-ref="content"></main>
      </div>
      <div class="toast-stack" data-ref="toasts"></div>`;
    parent.appendChild(this.root);

    this.navContainer = this.root.querySelector('[data-ref="nav"]')!;
    this.content = this.root.querySelector('[data-ref="content"]')!;
    this.toastStack = this.root.querySelector('[data-ref="toasts"]')!;

    this.buildNav();
    this.root.querySelector('[data-ref="tagline"]')!.textContent = t('app.tagline');
    window.addEventListener('keydown', this.onKeyCapture, true);
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
    if (visible) void this.render();
  }

  setProfile(profile: ProfileDto | null): void {
    this.profile = profile;
    if (!this.root.hidden) void this.render();
  }

  go(page: MenuPage): void {
    this.page = page;
    this.callbacks.playUiSound('ui_click');
    this.buildNav();
    void this.render();
  }

  toast(message: string, kind: 'info' | 'error' | 'success' = 'info'): void {
    const element = document.createElement('div');
    element.className = `toast ${kind === 'info' ? '' : kind}`;
    element.textContent = message;
    this.toastStack.appendChild(element);
    window.setTimeout(() => element.remove(), 3600);
  }

  private buildNav(): void {
    const pages: { page: MenuPage; labelKey: string }[] = [
      { page: 'home', labelKey: 'menu.main' },
      { page: 'modes', labelKey: 'menu.modes' },
      { page: 'loadout', labelKey: 'menu.loadout' },
      { page: 'campaign', labelKey: 'menu.campaign' },
      { page: 'profile', labelKey: 'menu.profile' },
      { page: 'stats', labelKey: 'menu.stats' },
      { page: 'achievements', labelKey: 'menu.achievements' },
      { page: 'missions', labelKey: 'menu.missions' },
      { page: 'shop', labelKey: 'menu.shop' },
      { page: 'friends', labelKey: 'menu.friends' },
      { page: 'leaderboard', labelKey: 'menu.leaderboard' },
      { page: 'settings', labelKey: 'menu.settings' },
    ];
    this.navContainer.replaceChildren();
    for (const entry of pages) {
      const button = document.createElement('button');
      button.textContent = t(entry.labelKey);
      button.classList.toggle('active', entry.page === this.page);
      button.addEventListener('click', () => this.go(entry.page));
      button.addEventListener('mouseenter', () => this.callbacks.playUiSound('ui_hover'));
      this.navContainer.appendChild(button);
    }
  }

  /** يعيد رسم الصفحة الحالية. */
  async render(): Promise<void> {
    switch (this.page) {
      case 'home': this.renderHome(); break;
      case 'modes': this.renderModes(); break;
      case 'loadout': await this.renderLoadout(); break;
      case 'campaign': await this.renderCampaign(); break;
      case 'profile': this.renderProfile(); break;
      case 'stats': await this.renderStats(); break;
      case 'achievements': await this.renderAchievements(); break;
      case 'missions': await this.renderMissions(); break;
      case 'shop': await this.renderShop(); break;
      case 'friends': await this.renderFriends(); break;
      case 'leaderboard': await this.renderLeaderboard(); break;
      case 'settings': this.renderSettings(); break;
      default: break;
    }
  }

  private header(titleKey: string, hintKey?: string): string {
    return `<h2>${escape(t(titleKey))}</h2>${hintKey ? `<div class="hint">${escape(t(hintKey))}</div>` : ''}`;
  }

  private profileStrip(): string {
    if (!this.profile) return '';
    const progress = levelFromXp(this.profile.xp);
    const percent = progress.xpForNext > 0 ? (progress.xpIntoLevel / progress.xpForNext) * 100 : 100;
    return `
      <div class="profile-strip">
        <div class="avatar">◆</div>
        <div>
          <div class="name">${escape(this.profile.displayName)}</div>
          <div class="meta">${escape(t('common.level'))} ${progress.level} · ${formatNumber(this.profile.rankRating)} ELO${
            this.profile.isGuest ? ` · ${escape(t('auth.guest'))}` : ''
          }</div>
          <div class="xp-bar"><i style="inline-size:${percent.toFixed(1)}%"></i></div>
        </div>
        <div class="shards">
          <div class="v">${formatNumber(this.profile.shards)}</div>
          <div class="k">${escape(t('shop.shards'))}</div>
        </div>
      </div>`;
  }

  // ─────────────────────────────── الصفحات ─────────────────────────────────

  private renderHome(): void {
    this.content.innerHTML = `
      ${this.profileStrip()}
      ${this.header('menu.main')}
      ${this.profile?.isGuest ? `<div class="hint">${escape(t('auth.guestNotice'))}</div>` : ''}
      <div class="card-grid">
        <div class="card" data-action="quick"><h3>${escape(t('menu.quickPlay'))}</h3><p>${escape(t('mode.crawl.desc'))}</p><span class="badge">${escape(t('mode.soloVsBots'))}</span></div>
        <div class="card" data-action="tutorial"><h3>${escape(t('menu.tutorial'))}</h3><p>${escape(t('mode.tutorial.desc'))}</p></div>
        <div class="card" data-action="campaign"><h3>${escape(t('menu.campaign'))}</h3><p>${escape(t('mode.campaign.desc'))}</p></div>
        <div class="card" data-action="modes"><h3>${escape(t('menu.modes'))}</h3><p>${escape(t('mode.shadowhunt.desc'))}</p></div>
      </div>`;
    this.content.querySelector('[data-action="quick"]')?.addEventListener('click', () => {
      this.callbacks.onStartMatch('crawl', this.selectedClass, { soloVsBots: true, difficulty: this.selectedDifficulty });
    });
    this.content.querySelector('[data-action="tutorial"]')?.addEventListener('click', () => this.callbacks.onStartTutorial());
    this.content.querySelector('[data-action="campaign"]')?.addEventListener('click', () => this.go('campaign'));
    this.content.querySelector('[data-action="modes"]')?.addEventListener('click', () => this.go('modes'));
  }

  private renderModes(): void {
    const modes: { mode: GameMode; titleKey: string; descKey: string }[] = [
      { mode: 'crawl', titleKey: 'mode.crawl', descKey: 'mode.crawl.desc' },
      { mode: 'shadowhunt', titleKey: 'mode.shadowhunt', descKey: 'mode.shadowhunt.desc' },
      { mode: 'campaign', titleKey: 'mode.campaign', descKey: 'mode.campaign.desc' },
      { mode: 'tutorial', titleKey: 'mode.tutorial', descKey: 'mode.tutorial.desc' },
    ];
    this.content.innerHTML = `
      ${this.header('menu.modes')}
      <div class="card-grid">
        ${modes
          .map(
            (entry) => `
          <div class="card" data-mode="${entry.mode}">
            <h3>${escape(t(entry.titleKey))}</h3>
            <p>${escape(t(entry.descKey))}</p>
          </div>`,
          )
          .join('')}
      </div>
      <div class="settings-group" style="margin-block-start:22px">
        <h3>${escape(t('campaign.difficulty'))}</h3>
        <div class="btn-row" data-ref="difficulty">
          ${(['easy', 'normal', 'hard'] as Difficulty[])
            .map(
              (level) =>
                `<button class="btn ${level === this.selectedDifficulty ? 'primary' : 'ghost'}" data-difficulty="${level}">${escape(
                  t(`campaign.difficulty.${level}`),
                )}</button>`,
            )
            .join('')}
        </div>
      </div>
      <div class="btn-row">
        <button class="btn primary" data-ref="play">${escape(t('common.play'))}</button>
      </div>`;

    let selected: GameMode = 'crawl';
    const cards = this.content.querySelectorAll<HTMLElement>('[data-mode]');
    const markSelection = (): void => {
      cards.forEach((card) => card.classList.toggle('selected', card.dataset.mode === selected));
    };
    cards.forEach((card) => {
      card.addEventListener('click', () => {
        selected = card.dataset.mode as GameMode;
        markSelection();
        this.callbacks.playUiSound('ui_click');
      });
    });
    markSelection();

    this.content.querySelectorAll<HTMLElement>('[data-difficulty]').forEach((button) => {
      button.addEventListener('click', () => {
        this.selectedDifficulty = button.dataset.difficulty as Difficulty;
        void this.render();
      });
    });

    this.content.querySelector('[data-ref="play"]')?.addEventListener('click', () => {
      if (selected === 'tutorial') this.callbacks.onStartTutorial();
      else if (selected === 'campaign') this.go('campaign');
      else {
        this.callbacks.onStartMatch(selected, this.selectedClass, {
          soloVsBots: false,
          difficulty: this.selectedDifficulty,
        });
      }
    });
  }

  private async renderLoadout(): Promise<void> {
    let owned: (CatalogItemDto & { owned: boolean })[] = [];
    try {
      const inventory = await this.api.getInventory();
      owned = inventory.catalog.filter((item) => item.owned);
    } catch {
      owned = [];
    }

    this.content.innerHTML = `
      ${this.header('menu.loadout')}
      <div class="card-grid">
        ${CLASS_KEYS.map((key) => {
          const cls = balance.classes[key];
          return `
          <div class="card ${key === this.selectedClass ? 'selected' : ''}" data-class="${key}">
            <h3>${escape(t(`class.${key}`))}</h3>
            <p>${escape(t(`class.${key}.desc`))}</p>
            <p style="margin-block-start:8px">
              ❤ ${cls.health} · ⚡ ${cls.speed} m/s · ⌖ ${escape(t(`weapon.${cls.primary}`))}
            </p>
            <p style="margin-block-start:6px;color:var(--hud-gold)">
              Q ${escape(t(`ability.${cls.abilities.q.key}`))} ·
              E ${escape(t(`ability.${cls.abilities.e.key}`))} ·
              F ${escape(t(`ability.${cls.abilities.f.key}`))}
            </p>
          </div>`;
        }).join('')}
      </div>
      <div class="settings-group" style="margin-block-start:24px">
        <h3>${escape(t('common.equipped'))}</h3>
        <div class="list">
          ${
            owned.length === 0
              ? `<div class="list-row"><span class="grow">${escape(t('common.none'))}</span></div>`
              : owned
                  .map(
                    (item) => `
            <div class="list-row">
              <span style="color:${item.colorPrimary}">◆</span>
              <span class="grow">${escape(getLocale() === 'ar' ? item.nameKeyAr : item.nameKeyEn)}</span>
              <span class="badge ${item.rarity}">${escape(t(`shop.rarity.${item.rarity}`))}</span>
            </div>`,
                  )
                  .join('')
          }
        </div>
      </div>
      <div class="btn-row">
        <button class="btn primary" data-ref="play">${escape(t('common.play'))}</button>
      </div>`;

    this.content.querySelectorAll<HTMLElement>('[data-class]').forEach((card) => {
      card.addEventListener('click', () => {
        this.selectedClass = card.dataset.class as ClassKey;
        void this.render();
      });
    });
    this.content.querySelector('[data-ref="play"]')?.addEventListener('click', () => {
      this.callbacks.onStartMatch('crawl', this.selectedClass, {
        soloVsBots: true,
        difficulty: this.selectedDifficulty,
      });
    });
  }

  private async renderCampaign(): Promise<void> {
    const slots = await listSaveSlots(this.api);
    this.content.innerHTML = `
      ${this.header('campaign.title', 'mode.campaign.desc')}
      <div class="card-grid">
        ${slots
          .map((save, index) => {
            const slot = index + 1;
            if (!save) {
              return `
              <div class="card" data-slot="${slot}" data-new="1">
                <h3>${escape(t('campaign.slot'))} ${slot}</h3>
                <p>${escape(t('common.empty'))}</p>
                <span class="badge">${escape(t('campaign.newGame'))}</span>
              </div>`;
            }
            const mission = CAMPAIGN_MISSIONS[save.missionIndex] ?? CAMPAIGN_MISSIONS[0]!;
            return `
            <div class="card" data-slot="${slot}">
              <h3>${escape(t('campaign.slot'))} ${slot}</h3>
              <p>${escape(t('campaign.mission'))} ${save.missionIndex + 1} — ${escape(t(mission.titleKey))}</p>
              <p>${escape(t('campaign.difficulty'))}: ${escape(t(`campaign.difficulty.${save.difficulty}`))}</p>
              <p>${escape(t('campaign.playTime'))}: ${formatDuration(save.playTimeS)}</p>
              <span class="badge">${escape(t('campaign.continue'))}</span>
            </div>`;
          })
          .join('')}
      </div>
      <div class="settings-group" style="margin-block-start:22px">
        <h3>${escape(t('campaign.difficulty'))}</h3>
        <div class="btn-row">
          ${(['easy', 'normal', 'hard'] as Difficulty[])
            .map(
              (level) =>
                `<button class="btn ${level === this.selectedDifficulty ? 'primary' : 'ghost'}" data-difficulty="${level}">${escape(
                  t(`campaign.difficulty.${level}`),
                )}</button>`,
            )
            .join('')}
        </div>
      </div>`;

    this.content.querySelectorAll<HTMLElement>('[data-difficulty]').forEach((button) => {
      button.addEventListener('click', () => {
        this.selectedDifficulty = button.dataset.difficulty as Difficulty;
        void this.render();
      });
    });

    this.content.querySelectorAll<HTMLElement>('[data-slot]').forEach((card) => {
      card.addEventListener('click', () => {
        const slot = Number(card.dataset.slot);
        const save = slots[slot - 1];
        this.callbacks.onStartCampaign(
          slot,
          save?.missionIndex ?? 0,
          (save?.difficulty as Difficulty) ?? this.selectedDifficulty,
          this.selectedClass,
        );
      });
    });
  }

  private renderProfile(): void {
    const isGuest = this.profile?.isGuest ?? true;
    this.content.innerHTML = `
      ${this.profileStrip()}
      ${this.header('menu.profile')}
      <div class="settings-group">
        <div class="setting-row">
          <label>${escape(t('auth.displayName'))}</label>
          <input type="text" data-ref="displayName" value="${escape(this.profile?.displayName ?? '')}" maxlength="20">
          <span class="readout"></span>
        </div>
        <div class="setting-row">
          <label>${escape(t('settings.language'))}</label>
          <select data-ref="locale">
            <option value="ar" ${getLocale() === 'ar' ? 'selected' : ''}>العربية</option>
            <option value="en" ${getLocale() === 'en' ? 'selected' : ''}>English</option>
          </select>
          <span class="readout"></span>
        </div>
      </div>
      ${
        isGuest
          ? `<div class="settings-group">
               <h3>${escape(t('auth.upgrade'))}</h3>
               <div class="hint">${escape(t('auth.guestNotice'))}</div>
               <div class="setting-row"><label>${escape(t('auth.email'))}</label><input type="email" data-ref="email"><span class="readout"></span></div>
               <div class="setting-row"><label>${escape(t('auth.password'))}</label><input type="password" data-ref="password"><span class="readout"></span></div>
               <div class="btn-row"><button class="btn primary" data-ref="upgrade">${escape(t('auth.upgrade'))}</button></div>
             </div>`
          : ''
      }
      <div class="settings-group">
        <h3>${escape(t('menu.account'))}</h3>
        <div class="btn-row">
          <button class="btn ghost" data-ref="export">${escape(t('common.save'))} JSON</button>
          <button class="btn ghost" data-ref="logout">${escape(t('auth.logout'))}</button>
          <button class="btn danger" data-ref="delete">${escape(t('common.delete'))}</button>
        </div>
      </div>`;

    const nameInput = this.content.querySelector<HTMLInputElement>('[data-ref="displayName"]');
    nameInput?.addEventListener('change', async () => {
      try {
        const updated = await this.api.patchProfile({ displayName: nameInput.value.trim() });
        this.setProfile({ ...updated, isGuest: this.profile?.isGuest });
        this.toast(t('common.save'), 'success');
      } catch {
        this.toast(t('auth.error.network'), 'error');
      }
    });

    this.content.querySelector<HTMLSelectElement>('[data-ref="locale"]')?.addEventListener('change', (event) => {
      const locale = (event.target as HTMLSelectElement).value as Locale;
      setLocale(locale);
      void this.api.patchProfile({ locale }).catch(() => undefined);
      this.callbacks.onLocaleChanged(locale);
      this.buildNav();
      void this.render();
    });

    this.content.querySelector('[data-ref="upgrade"]')?.addEventListener('click', async () => {
      const email = this.content.querySelector<HTMLInputElement>('[data-ref="email"]')?.value ?? '';
      const password = this.content.querySelector<HTMLInputElement>('[data-ref="password"]')?.value ?? '';
      try {
        const result = await this.api.upgrade(email, password);
        this.setProfile({ ...result.profile, isGuest: false });
        this.toast(t('common.confirm'), 'success');
      } catch (error) {
        const code = (error as { code?: string }).code ?? '';
        this.toast(
          code === 'email_taken'
            ? t('auth.error.email_taken')
            : code === 'invalid_body'
              ? t('auth.error.weak_password')
              : t('auth.error.network'),
          'error',
        );
      }
    });

    this.content.querySelector('[data-ref="export"]')?.addEventListener('click', async () => {
      try {
        const data = await this.api.exportData();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'duskfront-export.json';
        anchor.click();
        URL.revokeObjectURL(url);
      } catch {
        this.toast(t('auth.error.network'), 'error');
      }
    });

    this.content.querySelector('[data-ref="logout"]')?.addEventListener('click', () => this.callbacks.onLogout());

    this.content.querySelector('[data-ref="delete"]')?.addEventListener('click', async () => {
      if (!window.confirm(t('common.confirm'))) return;
      try {
        await this.api.deleteAccount();
        this.callbacks.onLogout();
      } catch {
        this.toast(t('auth.error.network'), 'error');
      }
    });
  }

  private async renderStats(): Promise<void> {
    let stats: Record<string, number | string | null> = {};
    try {
      stats = await this.api.getStats();
    } catch {
      /* offline */
    }
    const tiles: { key: string; value: string }[] = [
      { key: 'stats.matches', value: String(stats.matchesPlayed ?? 0) },
      { key: 'stats.wins', value: String(stats.wins ?? 0) },
      { key: 'scoreboard.kills', value: String(stats.kills ?? 0) },
      { key: 'scoreboard.deaths', value: String(stats.deaths ?? 0) },
      { key: 'scoreboard.assists', value: String(stats.assists ?? 0) },
      { key: 'stats.kd', value: String(stats.kd ?? 0) },
      { key: 'stats.winRate', value: `${Math.round(Number(stats.winRate ?? 0) * 100)}%` },
      { key: 'stats.timeInSun', value: formatDuration(Number(stats.timeInSunS ?? 0)) },
      { key: 'stats.timeInDark', value: formatDuration(Number(stats.timeInDarkS ?? 0)) },
      { key: 'stats.wellsCaptured', value: String(stats.wellsCaptured ?? 0) },
      { key: 'stats.mirrorReveals', value: String(stats.mirrorReveals ?? 0) },
      { key: 'stats.crawlers', value: String(stats.crawlersDestroyed ?? 0) },
    ];
    this.content.innerHTML = `
      ${this.header('menu.stats')}
      <div class="stat-grid">
        ${tiles.map((tile) => `<div class="stat-tile"><div class="k">${escape(t(tile.key))}</div><div class="v">${escape(tile.value)}</div></div>`).join('')}
      </div>`;
  }

  private async renderAchievements(): Promise<void> {
    let achievements: AchievementDto[] = [];
    try {
      achievements = (await this.api.getAchievements()).achievements;
    } catch {
      /* offline */
    }
    this.content.innerHTML = `
      ${this.header('achievements.title')}
      <div class="list">
        ${achievements
          .map((entry) => {
            const percent = Math.min(100, (entry.progress / entry.target) * 100);
            return `
            <div class="list-row ${entry.unlockedAt ? 'done' : ''}">
              <span>${entry.unlockedAt ? '🏆' : '🔒'}</span>
              <div class="grow">
                <div>${escape(t(entry.key))}</div>
                <div class="progress"><i style="inline-size:${percent.toFixed(1)}%"></i></div>
              </div>
              <span class="num">${entry.progress}/${entry.target}</span>
              <span class="num">+${entry.rewardShards}</span>
            </div>`;
          })
          .join('')}
      </div>`;
  }

  private async renderMissions(): Promise<void> {
    let payload: { day: string; resetsInSec: number; missions: MissionDto[] } | null = null;
    try {
      payload = await this.api.getMissions();
    } catch {
      /* offline */
    }
    this.content.innerHTML = `
      ${this.header('missions.title')}
      <div class="hint">${escape(t('missions.resetsIn'))} ${formatDuration(payload?.resetsInSec ?? 0)}</div>
      <div class="list">
        ${(payload?.missions ?? [])
          .map((mission) => {
            const percent = Math.min(100, (mission.progress / mission.target) * 100);
            const complete = mission.progress >= mission.target;
            return `
            <div class="list-row ${complete ? 'done' : ''}">
              <div class="grow">
                <div>${escape(t(mission.key))}</div>
                <div class="progress"><i style="inline-size:${percent.toFixed(1)}%"></i></div>
              </div>
              <span class="num">${mission.progress}/${mission.target}</span>
              <span class="num">+${mission.rewardXp} XP</span>
              <button class="btn ${complete && !mission.claimed ? 'primary' : 'ghost'}" data-mission="${mission.missionId}" ${
                complete && !mission.claimed ? '' : 'disabled'
              }>${escape(mission.claimed ? t('missions.claimed') : t('missions.claim'))}</button>
            </div>`;
          })
          .join('')}
      </div>`;

    this.content.querySelectorAll<HTMLElement>('[data-mission]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          const result = await this.api.claimMission(button.dataset.mission!);
          this.toast(`+${result.xp} XP · +${result.shards}`, 'success');
          await this.refreshProfile();
          await this.render();
        } catch {
          this.toast(t('auth.error.network'), 'error');
        }
      });
    });
  }

  private async renderShop(): Promise<void> {
    let catalog: (CatalogItemDto & { owned: boolean })[] = [];
    try {
      catalog = (await this.api.getInventory()).catalog;
    } catch {
      /* offline */
    }
    this.content.innerHTML = `
      ${this.profileStrip()}
      ${this.header('shop.title', 'shop.notice')}
      <div class="card-grid">
        ${catalog
          .map(
            (item) => `
          <div class="card">
            <h3 style="color:${item.colorPrimary}">${escape(getLocale() === 'ar' ? item.nameKeyAr : item.nameKeyEn)}</h3>
            <p>${escape(item.classKey ? t(`class.${item.classKey}`) : t(`shop.rarity.${item.rarity}`))}</p>
            <span class="badge ${item.rarity}">${escape(t(`shop.rarity.${item.rarity}`))}</span>
            <div class="btn-row">
              <button class="btn ${item.owned ? 'ghost' : 'primary'}" data-item="${escape(item.key)}" ${item.owned ? 'disabled' : ''}>
                ${item.owned ? escape(t('common.owned')) : `${escape(t('shop.buy'))} · ${item.priceShards}`}
              </button>
            </div>
          </div>`,
          )
          .join('')}
      </div>`;

    this.content.querySelectorAll<HTMLElement>('[data-item]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          await this.api.buy(button.dataset.item!);
          this.toast(t('common.confirm'), 'success');
          await this.refreshProfile();
          await this.render();
        } catch (error) {
          const code = (error as { code?: string }).code;
          this.toast(code === 'insufficient_shards' ? t('shop.insufficient') : t('auth.error.network'), 'error');
        }
      });
    });
  }

  private async renderFriends(): Promise<void> {
    let friends: FriendDto[] = [];
    try {
      friends = (await this.api.getFriends()).friends;
    } catch {
      /* offline */
    }
    this.content.innerHTML = `
      ${this.header('friends.title')}
      <div class="settings-group">
        <div class="setting-row">
          <label>${escape(t('friends.add'))}</label>
          <input type="text" data-ref="friendId" placeholder="user id">
          <button class="btn ghost" data-ref="addFriend">+</button>
        </div>
      </div>
      <div class="list">
        ${
          friends.length === 0
            ? `<div class="list-row"><span class="grow">${escape(t('common.none'))}</span></div>`
            : friends
                .map(
                  (friend) => `
          <div class="list-row">
            <span>${friend.status === 'accepted' ? '🟢' : '🕓'}</span>
            <div class="grow">
              <div>${escape(friend.displayName)}</div>
              <div class="hint">${escape(t(`friends.${friend.status === 'accepted' ? 'accepted' : 'pending'}`))}</div>
            </div>
            <button class="btn ghost" data-remove="${escape(friend.userId)}">${escape(t('friends.remove'))}</button>
          </div>`,
                )
                .join('')
        }
      </div>`;

    this.content.querySelector('[data-ref="addFriend"]')?.addEventListener('click', async () => {
      const value = this.content.querySelector<HTMLInputElement>('[data-ref="friendId"]')?.value.trim();
      if (!value) return;
      try {
        await this.api.addFriend(value);
        await this.render();
      } catch {
        this.toast(t('auth.error.network'), 'error');
      }
    });
    this.content.querySelectorAll<HTMLElement>('[data-remove]').forEach((button) => {
      button.addEventListener('click', async () => {
        await this.api.removeFriend(button.dataset.remove!).catch(() => undefined);
        await this.render();
      });
    });
  }

  private async renderLeaderboard(): Promise<void> {
    let rows: LeaderboardRowDto[] = [];
    try {
      rows = (await this.api.getLeaderboard('crawl', 1)).rows;
    } catch {
      /* offline */
    }
    this.content.innerHTML = `
      ${this.header('menu.leaderboard')}
      ${
        rows.length === 0
          ? `<div class="hint">${escape(t('leaderboard.empty'))}</div>`
          : `<div class="list">
              ${rows
                .map(
                  (row, index) => `
                <div class="list-row">
                  <span class="num">#${index + 1}</span>
                  <div class="grow"><div>${escape(row.displayName)}</div>
                    <div class="hint">${escape(t('common.level'))} ${row.level} · ${row.wins}/${row.matchesPlayed}</div></div>
                  <span class="num">${formatNumber(row.rankRating)}</span>
                </div>`,
                )
                .join('')}
            </div>`
      }`;
  }

  private renderSettings(): void {
    const settings = this.settings.value;
    this.content.innerHTML = `
      ${this.header('menu.settings')}

      <div class="settings-group">
        <h3>${escape(t('settings.graphics'))}</h3>
        ${selectRow('settings.tier', 'graphics.tier', settings.graphics.tier, [
          ['low', t('settings.tier.low')],
          ['medium', t('settings.tier.medium')],
          ['high', t('settings.tier.high')],
        ])}
        ${rangeRow('settings.resolutionScale', 'graphics.resolutionScale', settings.graphics.resolutionScale, 0.5, 1.5, 0.05)}
        ${rangeRow('settings.fov', 'graphics.fov', settings.graphics.fov, balance.graphics.fovMin, balance.graphics.fovMax, 1)}
        ${rangeRow('settings.fpsCap', 'graphics.fpsCap', settings.graphics.fpsCap, 30, 240, 10)}
        ${toggleRow('settings.shadows', 'graphics.shadows', settings.graphics.shadows)}
        ${toggleRow('settings.bloom', 'graphics.bloom', settings.graphics.bloom)}
      </div>

      <div class="settings-group">
        <h3>${escape(t('settings.audio'))}</h3>
        ${rangeRow('settings.master', 'audio.master', settings.audio.master, 0, 1, 0.05)}
        ${rangeRow('settings.music', 'audio.music', settings.audio.music, 0, 1, 0.05)}
        ${rangeRow('settings.sfx', 'audio.sfx', settings.audio.sfx, 0, 1, 0.05)}
      </div>

      <div class="settings-group">
        <h3>${escape(t('settings.controls'))}</h3>
        ${rangeRow('settings.sensitivity', 'controls.sensitivity', settings.controls.sensitivity, 0.1, 4, 0.05)}
        ${rangeRow('settings.adsSensitivity', 'controls.adsSensitivity', settings.controls.adsSensitivity, 0.1, 4, 0.05)}
        ${rangeRow('settings.gamepadSensitivity', 'controls.gamepadSensitivity', settings.controls.gamepadSensitivity, 0.1, 4, 0.05)}
        ${toggleRow('settings.invertY', 'controls.invertY', settings.controls.invertY)}
        ${toggleRow('settings.autoFireOnAim', 'controls.autoFireOnAim', settings.controls.autoFireOnAim)}
        ${toggleRow('settings.aimAssist', 'controls.aimAssist', settings.controls.aimAssist)}
      </div>

      <div class="settings-group">
        <h3>${escape(t('settings.bindings'))}</h3>
        ${ACTIONS.map(
          (action) => `
          <div class="setting-row">
            <label>${escape(t(`bind.${action}`))}</label>
            <div><button class="bind-button" data-bind="${action}">${escape(describeKeyCode(this.input.getBinding(action)))}</button></div>
            <span class="readout"></span>
          </div>`,
        ).join('')}
      </div>

      <div class="settings-group">
        <h3>${escape(t('settings.accessibility'))}</h3>
        ${selectRow('settings.colorBlind', 'accessibility.colorBlindMode', settings.accessibility.colorBlindMode, [
          ['none', t('settings.colorBlind.none')],
          ['protanopia', t('settings.colorBlind.protanopia')],
          ['deuteranopia', t('settings.colorBlind.deuteranopia')],
          ['tritanopia', t('settings.colorBlind.tritanopia')],
        ])}
        ${rangeRow('settings.fontScale', 'accessibility.fontScale', settings.accessibility.fontScale, 0.8, 1.6, 0.05)}
        ${toggleRow('settings.subtitles', 'accessibility.subtitles', settings.accessibility.subtitles)}
        ${toggleRow('settings.reducedShake', 'accessibility.reducedShake', settings.accessibility.reducedShake)}
        ${toggleRow('settings.highContrastHud', 'accessibility.highContrastHud', settings.accessibility.highContrastHud)}
      </div>

      <div class="settings-group">
        <h3>${escape(t('settings.language'))}</h3>
        <div class="btn-row">
          <button class="btn ${getLocale() === 'ar' ? 'primary' : 'ghost'}" data-locale="ar">العربية</button>
          <button class="btn ${getLocale() === 'en' ? 'primary' : 'ghost'}" data-locale="en">English</button>
        </div>
      </div>`;

    this.wireSettingInputs();
  }

  private wireSettingInputs(): void {
    this.content.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-path]').forEach((element) => {
      const path = element.dataset.path!;
      const commit = (): void => {
        const value =
          element instanceof HTMLInputElement && element.type === 'checkbox'
            ? element.checked
            : element instanceof HTMLInputElement && element.type === 'range'
              ? Number(element.value)
              : element.value;
        this.settings.patch(buildPatch(path, value));
        const readout = element.closest('.setting-row')?.querySelector('.readout');
        if (readout && element instanceof HTMLInputElement && element.type === 'range') {
          readout.textContent = element.value;
        }
        this.callbacks.onSettingsChanged();
      };
      element.addEventListener('input', commit);
      element.addEventListener('change', commit);
    });

    this.content.querySelectorAll<HTMLElement>('[data-bind]').forEach((button) => {
      button.addEventListener('click', () => {
        this.content.querySelectorAll('.bind-button').forEach((other) => other.classList.remove('listening'));
        button.classList.add('listening');
        button.textContent = t('settings.pressKey');
        this.listeningFor = button.dataset.bind as ActionName;
      });
    });

    this.content.querySelectorAll<HTMLElement>('[data-locale]').forEach((button) => {
      button.addEventListener('click', () => {
        const locale = button.dataset.locale as Locale;
        setLocale(locale);
        void this.api.patchProfile({ locale }).catch(() => undefined);
        this.callbacks.onLocaleChanged(locale);
        this.buildNav();
        void this.render();
      });
    });
  }

  /** يلتقط ضغطة المفتاح أثناء إعادة التعيين قبل أن تصل إلى اللعبة. */
  private readonly onKeyCapture = (event: KeyboardEvent): void => {
    if (!this.listeningFor) return;
    event.preventDefault();
    event.stopPropagation();
    const action = this.listeningFor;
    this.listeningFor = null;
    this.input.bind(action, event.code);
    this.settings.patch({ controls: { bindings: this.input.currentBindings } });
    this.callbacks.onSettingsChanged();
    void this.render();
  };

  private async refreshProfile(): Promise<void> {
    try {
      const profile = await this.api.getProfile();
      this.setProfile(profile);
    } catch {
      /* offline */
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyCapture, true);
    this.root.remove();
  }
}

// ─────────────────────────────── مساعدات ────────────────────────────────────

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

function rangeRow(labelKey: string, path: string, value: number, min: number, max: number, step: number): string {
  return `
    <div class="setting-row">
      <label>${escape(t(labelKey))}</label>
      <input type="range" data-path="${path}" min="${min}" max="${max}" step="${step}" value="${value}">
      <span class="readout">${value}</span>
    </div>`;
}

function toggleRow(labelKey: string, path: string, value: boolean): string {
  return `
    <div class="setting-row">
      <label>${escape(t(labelKey))}</label>
      <div><input type="checkbox" data-path="${path}" ${value ? 'checked' : ''}></div>
      <span class="readout"></span>
    </div>`;
}

function selectRow(labelKey: string, path: string, value: string, options: [string, string][]): string {
  return `
    <div class="setting-row">
      <label>${escape(t(labelKey))}</label>
      <select data-path="${path}">
        ${options.map(([key, label]) => `<option value="${key}" ${key === value ? 'selected' : ''}>${escape(label)}</option>`).join('')}
      </select>
      <span class="readout"></span>
    </div>`;
}

/** يحوّل "graphics.fov" + قيمة إلى كائن تعديل متداخل. */
function buildPatch(path: string, value: unknown): Partial<PlayerSettingsBundle> {
  const [group, key] = path.split('.') as [keyof PlayerSettingsBundle, string];
  return { [group]: { [key]: value } } as Partial<PlayerSettingsBundle>;
}
