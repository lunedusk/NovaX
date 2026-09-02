import { getLogger } from '#core/utils/logger.js';
import type { UpdateInstructMessage } from '../types.js';

const log = getLogger('CrossHost:UpdateClient');

export async function runWorkerUpdate(instruct: UpdateInstructMessage): Promise<void> {
    const desired = instruct.desiredState;
    log.info('Worker update path starting', {
        instructId: instruct.instructId,
        zeneVersion: desired.zeneVersion,
        pluginCount: desired.plugins.length,
    });

    const { runUpdater } = await import('#core/manager/updater/index.js');
    await runUpdater({
        force: true,
        targetTag: desired.zeneVersion.startsWith('v')
            ? desired.zeneVersion
            : `v${desired.zeneVersion}`,
    });

    log.info('Worker update path finished', {
        instructId: instruct.instructId,
        target: desired.zeneVersion,
    });
}
