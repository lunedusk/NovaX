import { getLogger } from '#core/utils/logger.js';
import type { UpdateInstructMessage } from '../types.js';

const log = getLogger('CrossHost:UpdateClient');

export async function runWorkerUpdate(instruct: UpdateInstructMessage): Promise<void> {
    const desired = instruct.desiredState;
    log.info('Worker update path starting', {
        instructId: instruct.instructId,
        novaxVersion: desired.novaxVersion,
        pluginCount: desired.plugins.length,
    });

    const { runUpdater } = await import('#core/manager/updater/index.js');
    await runUpdater({
        force: true,
        targetTag: desired.novaxVersion.startsWith('v')
            ? desired.novaxVersion
            : `v${desired.novaxVersion}`,
    });

    log.info('Worker update path finished', {
        instructId: instruct.instructId,
        target: desired.novaxVersion,
    });
}
