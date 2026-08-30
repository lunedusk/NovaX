import { getLogger } from '#core/utils/logger.js';
import type { AssignmentReason } from '../types.js';

const log = getLogger('CrossHost:Hooks');

const DEFAULT_TIMEOUT_MS = 10_000;

export type AssignmentHook = (
    shards: readonly number[],
    reason: AssignmentReason,
) => void | Promise<void>;

export type DrainHook = (
    shards: readonly number[],
    reason: AssignmentReason,
) => void | Promise<void>;

export type UpdateHook = (desired: {
    novaxVersion: string;
    plugins: readonly { id: string; version: string }[];
}) => void | Promise<void>;

export type UpdateResultHook = (result: { ok: boolean; message: string }) => void | Promise<void>;

export class WorkerHookRegistry {
    private readonly beforeAssignment: AssignmentHook[] = [];
    private readonly afterAssignment: AssignmentHook[] = [];
    private readonly beforeDrain: DrainHook[] = [];
    private readonly afterDrain: DrainHook[] = [];
    private readonly beforeUpdate: UpdateHook[] = [];
    private readonly afterUpdate: UpdateResultHook[] = [];
    private timeoutMs = DEFAULT_TIMEOUT_MS;

    public setTimeoutMs(ms: number): void {
        this.timeoutMs = Math.max(100, ms);
    }

    public onBeforeAssignment(fn: AssignmentHook): void {
        this.beforeAssignment.push(fn);
    }

    public onAfterAssignment(fn: AssignmentHook): void {
        this.afterAssignment.push(fn);
    }

    public onBeforeDrain(fn: DrainHook): void {
        this.beforeDrain.push(fn);
    }

    public onAfterDrain(fn: DrainHook): void {
        this.afterDrain.push(fn);
    }

    public onBeforeUpdate(fn: UpdateHook): void {
        this.beforeUpdate.push(fn);
    }

    public onAfterUpdate(fn: UpdateResultHook): void {
        this.afterUpdate.push(fn);
    }

    private async runAll(
        label: string,
        hooks: ReadonlyArray<(...args: never[]) => void | Promise<void>>,
        invoke: (fn: (...args: never[]) => void | Promise<void>) => Promise<void>,
    ): Promise<void> {
        for (const fn of hooks) {
            try {
                await Promise.race([
                    invoke(fn),
                    new Promise<void>((_, reject) => {
                        setTimeout(() => reject(new Error(`hook timeout after ${this.timeoutMs}ms`)), this.timeoutMs).unref();
                    }),
                ]);
            } catch (err) {
                log.error(`Hook ${label} failed`, err);
            }
        }
    }

    public async runBeforeAssignment(
        shards: readonly number[],
        reason: AssignmentReason,
    ): Promise<void> {
        await this.runAll('beforeAssignment', this.beforeAssignment as never[], async (fn) => {
            await (fn as AssignmentHook)(shards, reason);
        });
    }

    public async runAfterAssignment(
        shards: readonly number[],
        reason: AssignmentReason,
    ): Promise<void> {
        await this.runAll('afterAssignment', this.afterAssignment as never[], async (fn) => {
            await (fn as AssignmentHook)(shards, reason);
        });
    }

    public async runBeforeDrain(
        shards: readonly number[],
        reason: AssignmentReason,
    ): Promise<void> {
        await this.runAll('beforeDrain', this.beforeDrain as never[], async (fn) => {
            await (fn as DrainHook)(shards, reason);
        });
    }

    public async runAfterDrain(
        shards: readonly number[],
        reason: AssignmentReason,
    ): Promise<void> {
        await this.runAll('afterDrain', this.afterDrain as never[], async (fn) => {
            await (fn as DrainHook)(shards, reason);
        });
    }

    public async runBeforeUpdate(desired: {
        novaxVersion: string;
        plugins: readonly { id: string; version: string }[];
    }): Promise<void> {
        await this.runAll('beforeUpdate', this.beforeUpdate as never[], async (fn) => {
            await (fn as UpdateHook)(desired);
        });
    }

    public async runAfterUpdate(result: { ok: boolean; message: string }): Promise<void> {
        await this.runAll('afterUpdate', this.afterUpdate as never[], async (fn) => {
            await (fn as UpdateResultHook)(result);
        });
    }
}

export const workerHooks = new WorkerHookRegistry();