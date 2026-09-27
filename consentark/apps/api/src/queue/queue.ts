/**
 * TaskQueue — the contract the worker loop consumes.
 *
 * Phase 1 ships an in-memory FIFO with SQLite persistence underneath
 * (memoryQueue + the task runner's recovery pass). If Redis/BullMQ becomes
 * available later, `bullmqQueue` implements this same interface and nothing
 * else changes (Phase 0 decision).
 */
export interface TaskQueue {
  /** Add a task id to the queue (no-op if already queued/reserved). */
  enqueue(taskId: string): void;
  /** Reserve and return the next task id, or null when empty. */
  popReady(): string | null;
  /** Release a reservation after the task left the runner. */
  complete(taskId: string): void;
  /** Remove a still-waiting task (cancel path). Returns true if removed. */
  cancel(taskId: string): boolean;
  /** Queued (waiting + reserved) count. */
  size(): number;
}
