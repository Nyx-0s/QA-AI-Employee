import type { Locator, Page } from "@playwright/test";

export interface ExecutionContext {

    // Playwright
    page: Page;

    // Current working objects
    current?: Locator;
    currentForm?: Locator;
    currentRow?: Locator;

    // Runtime storage
    variables: Record<string, unknown>;

    // Execution tracking
    observations: string[];

    // Metadata
    testId?: string;
    module?: string;
    step?: number;
    startedAt?: Date;

    // Evidence
    screenshots?: string[];
    attachments?: string[];

    // Runtime state
    state?: Record<string, unknown>;

    // Recovery
    retries?: number;

    // AI / Planning
    ai?: {
        enabled: boolean;
        confidence?: number;
        planner?: string;
    };

}
