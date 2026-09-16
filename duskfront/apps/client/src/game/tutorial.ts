/**
 * الدرس التعليمي: سبع خطوات تفاعلية، كل خطوة تنتظر فعلًا حقيقيًا من اللاعب.
 * Seven interactive steps. Each one watches the real simulation for the real action —
 * nothing advances on a timer alone.
 */
import { balance, type MatchSnapshot } from '@duskfront/shared';
import type { LocalMatch } from './match-session.js';

export interface TutorialStep {
  key: string;
  /** يعيد true عندما يُنجز اللاعب الخطوة */
  isComplete(context: TutorialContext): boolean;
}

export interface TutorialContext {
  snapshot: MatchSnapshot;
  match: LocalMatch;
  elapsed: number;
  movedDistance: number;
  hasJumped: boolean;
  hasSprinted: boolean;
  shotsFired: number;
  mirrorsPlaced: number;
  wellsCaptured: number;
  votedCrawler: boolean;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  { key: 'tutorial.step1', isComplete: (context) => context.movedDistance > 18 },
  { key: 'tutorial.step2', isComplete: (context) => context.hasJumped && context.hasSprinted },
  {
    key: 'tutorial.step3',
    isComplete: (context) => {
      const local = context.snapshot.players.find((player) => player.id === context.match.localId);
      return local?.zone === 'dusk' && context.elapsed > 6;
    },
  },
  { key: 'tutorial.step4', isComplete: (context) => context.shotsFired >= 5 },
  { key: 'tutorial.step5', isComplete: (context) => context.mirrorsPlaced >= 1 },
  { key: 'tutorial.step6', isComplete: (context) => context.wellsCaptured >= 1 },
  { key: 'tutorial.step7', isComplete: (context) => context.votedCrawler },
];

export class TutorialRun {
  private stepIndex = 0;
  private readonly context: TutorialContext;
  private lastPosition: { x: number; z: number } | null = null;

  constructor(readonly match: LocalMatch) {
    this.context = {
      snapshot: match.snapshot()!,
      match,
      elapsed: 0,
      movedDistance: 0,
      hasJumped: false,
      hasSprinted: false,
      shotsFired: 0,
      mirrorsPlaced: 0,
      wellsCaptured: 0,
      votedCrawler: false,
    };
  }

  get currentStep(): TutorialStep | null {
    return TUTORIAL_STEPS[this.stepIndex] ?? null;
  }

  get stepNumber(): number {
    return this.stepIndex + 1;
  }

  get totalSteps(): number {
    return balance.tutorial.steps;
  }

  get finished(): boolean {
    return this.stepIndex >= TUTORIAL_STEPS.length;
  }

  noteShot(): void {
    this.context.shotsFired++;
  }

  noteJump(): void {
    this.context.hasJumped = true;
  }

  noteSprint(): void {
    this.context.hasSprinted = true;
  }

  noteCrawlerVote(): void {
    this.context.votedCrawler = true;
  }

  /** يتقدّم بالدرس بناءً على الحالة الحقيقية للمحاكاة. */
  tick(snapshot: MatchSnapshot, dt: number): void {
    this.context.snapshot = snapshot;
    this.context.elapsed += dt;

    const local = snapshot.players.find((player) => player.id === this.match.localId);
    if (local) {
      if (this.lastPosition) {
        this.context.movedDistance += Math.hypot(
          local.position.x - this.lastPosition.x,
          local.position.z - this.lastPosition.z,
        );
      }
      this.lastPosition = { x: local.position.x, z: local.position.z };
    }

    const player = this.match.sim.getPlayer(this.match.localId);
    if (player) {
      this.context.mirrorsPlaced = player.stats.mirrorsPlaced;
      this.context.wellsCaptured = player.stats.wellsCaptured;
    }

    const step = this.currentStep;
    if (step && step.isComplete(this.context)) {
      this.stepIndex++;
      this.context.elapsed = 0;
    }
  }
}
