import { PerformanceMetrics } from "./Types";

export class PerformanceMonitor {
  private startedAt = 0;

  start(): void {
    this.startedAt = Date.now();
  }

  stop(): PerformanceMetrics {
    const finishedAt = Date.now();

    return {
      startedAt: this.startedAt,
      finishedAt,
      durationMs: finishedAt - this.startedAt,
    };
  }

  reset(): void {
    this.startedAt = 0;
  }
}
