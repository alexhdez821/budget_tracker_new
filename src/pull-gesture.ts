/** Phone pull-to-refresh gesture. The indicator is drawn only after the touch clears slop at the top, so native overscroll still works for every other gesture. */

export const PULL_THRESHOLD_PX = 64;
export const PULL_SLOP_PX = 8;
export const PULL_MAX_PX = 96;
const PULL_DAMPING = 0.55;

export type PullPhase = "idle" | "pulling" | "armed" | "refreshing";

export interface PullSample {
  preventDefault: boolean;
  distance: number;
  phase: PullPhase;
}

export class PullGesture {
  private startX = 0;
  private startY = 0;
  private tracking = false;
  private decided = false;
  phase: PullPhase = "idle";
  distance = 0;

  constructor(
    private readonly options: {
      atTop: () => boolean;
      enabled: () => boolean;
      threshold?: number;
      slop?: number;
      max?: number;
    },
  ) {}

  get isTracking(): boolean {
    return this.tracking;
  }

  start(x: number, y: number): void {
    if (this.phase === "refreshing" || !this.options.enabled() || !this.options.atTop()) {
      this.tracking = false;
      return;
    }
    this.tracking = true;
    this.decided = false;
    this.startX = x;
    this.startY = y;
    this.distance = 0;
    this.phase = "idle";
  }

  move(x: number, y: number): PullSample {
    if (!this.tracking || this.phase === "refreshing") {
      return { preventDefault: false, distance: this.distance, phase: this.phase };
    }
    if (!this.options.atTop()) {
      this.reset();
      return { preventDefault: false, distance: 0, phase: "idle" };
    }
    const dx = x - this.startX;
    const dy = y - this.startY;
    const slop = this.options.slop ?? PULL_SLOP_PX;
    if (!this.decided) {
      if (Math.abs(dx) < slop && Math.abs(dy) < slop) {
        return { preventDefault: false, distance: 0, phase: "idle" };
      }
      if (dy <= 0 || Math.abs(dx) > dy) {
        this.reset();
        return { preventDefault: false, distance: 0, phase: "idle" };
      }
      this.decided = true;
    }
    const max = this.options.max ?? PULL_MAX_PX;
    this.distance = Math.min(max, Math.max(0, dy) * PULL_DAMPING);
    const threshold = this.options.threshold ?? PULL_THRESHOLD_PX;
    this.phase = this.distance >= threshold ? "armed" : "pulling";
    return { preventDefault: true, distance: this.distance, phase: this.phase };
  }

  /** True when the finger released past the threshold. */
  end(): boolean {
    const refresh = this.phase === "armed";
    this.tracking = false;
    this.decided = false;
    if (refresh) {
      this.phase = "refreshing";
      return true;
    }
    this.distance = 0;
    this.phase = "idle";
    return false;
  }

  finish(): void {
    this.reset();
  }

  private reset(): void {
    this.tracking = false;
    this.decided = false;
    this.distance = 0;
    this.phase = "idle";
  }
}
