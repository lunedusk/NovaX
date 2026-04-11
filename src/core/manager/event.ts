import { EventBus } from './events/EventBus.js';

export type { EventCallback, EventResult, ListenerOptions } from './events/EventBus.js';

export const eventBus = new EventBus();