import type { ValidationContext } from '#core/validation/index.js';
import type { IHeart } from '#core/heart/index.js';

export async function validate(
    data: unknown,
    _ctx: ValidationContext,
    heart?: IHeart | null
): Promise<true | string | string[]> {
    const d = data as {
        guildGate?: { engine?: string; alias?: string };
        updateIntervalSeconds?: number;
    };

    if (d.updateIntervalSeconds != null && d.updateIntervalSeconds < 5) {
        return 'updateIntervalSeconds must be >= 5 when set';
    }

    const eng = d.guildGate?.engine?.toLowerCase();
    if (eng && !['sqlite', 'postgres', 'mongo', 'native-pg', 'native-sqlite'].includes(eng)) {
        return `guildGate.engine unsupported: ${eng}`;
    }

    if (heart && eng) {
        heart.log.debug(`core config rules: guildGate.engine=${eng} alias=${d.guildGate?.alias ?? 'main'}`);
    }

    return true;
}

export default validate;
