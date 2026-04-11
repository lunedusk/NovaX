import { eventBus } from '#core/manager/events/EventBus.js';
import { scheduler } from '#core/scheduler/index.js';
import { CooldownManager } from '#core/manager/cooldown.js';

export type SystemDomain = {
    readonly events: typeof eventBus;
    readonly scheduler: typeof scheduler;
};

export const systemDomain: SystemDomain = Object.freeze({
    events: eventBus,
    scheduler: scheduler,
    cooldowns: CooldownManager
});