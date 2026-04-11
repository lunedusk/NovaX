import { httpServer } from '#core/manager/http/server.js';
import { metricsManager } from '#core/manager/metrics/index.js';

export type NetDomain = {
    readonly http: typeof httpServer;
    readonly metrics: typeof metricsManager;
};

export const netDomain: NetDomain = Object.freeze({
    http: httpServer,
    metrics: metricsManager
});