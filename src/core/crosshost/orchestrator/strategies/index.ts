import type { StrategyId } from '../../types.js';
import type { AssignmentStrategy } from './types.js';
import { leastLoadedStrategy } from './leastLoaded.js';
import { stickyStrategy } from './sticky.js';
import { manualStrategy } from './manual.js';
import { regionAwareStrategy } from './regionAware.js';

const strategies: Record<StrategyId, AssignmentStrategy> = {
    least_loaded: leastLoadedStrategy,
    sticky: stickyStrategy,
    manual: manualStrategy,
    region_aware: regionAwareStrategy,
};

export function getStrategy(id: StrategyId): AssignmentStrategy {
    return strategies[id] ?? leastLoadedStrategy;
}

export type { AssignmentStrategy, StrategyInput } from './types.js';
export { leastLoadedStrategy, stickyStrategy, manualStrategy, regionAwareStrategy };
