import type { TaskQueue } from "./queue.js";

/**
 * In-process FIFO queue. Tasks are persisted to SQLite by the API *before*
 * enqueue, so durability never depended on this structure — on boot the
 * task runner re-enqueues `queued` rows and re-runs `running` rows that a
 * crash interrupted (see taskRunner.recover()).
 */
export class MemoryTaskQueue implements TaskQueue {
  private items: string[] = [];
  /** Ids popped for execution but not yet completed — never handed out twice. */
  private reserved = new Set<string>();

  enqueue(taskId: string): void {
    if (this.reserved.has(taskId)) return;
    if (!this.items.includes(taskId)) this.items.push(taskId);
  }

  popReady(): string | null {
    const next = this.items.shift();
    if (next === undefined) return null;
    this.reserved.add(next);
    return next;
  }

  complete(taskId: string): void {
    this.reserved.delete(taskId);
    this.items = this.items.filter((id) => id !== taskId);
  }

  cancel(taskId: string): boolean {
    const before = this.items.length;
    this.items = this.items.filter((id) => id !== taskId);
    return this.items.length < before;
  }

  size(): number {
    return this.items.length + this.reserved.size;
  }
}
