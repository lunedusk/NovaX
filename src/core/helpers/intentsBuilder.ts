import { GatewayIntentBits, IntentsBitField } from 'discord.js';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('IntentBuilder');

const INTENT_FLAGS = GatewayIntentBits;

export class IntentBuilder {
    private readonly privileged = [
        INTENT_FLAGS.GuildMembers,
        INTENT_FLAGS.GuildPresences,
        INTENT_FLAGS.MessageContent
    ];

    private readonly unprivileged = Object.values(INTENT_FLAGS)
        .filter((v): v is number => typeof v === 'number')
        .filter(v => !this.privileged.includes(v));

    public build(input?: string[]): IntentsBitField {
        if (!input || input.length === 0) {
            log.warn('No intents specified. Falling back to safe unprivileged defaults.');
            return new IntentsBitField(this.unprivileged);
        }

        const bitfield = new IntentsBitField();
        const requested = input.map(s => s.trim().toLowerCase());

        if (requested.includes('all')) {
            bitfield.add(Object.values(INTENT_FLAGS).filter((v): v is number => typeof v === 'number'));
        } else if (requested.includes('default') || requested.includes('unprivileged')) {
            bitfield.add(this.unprivileged);
        }

        const errors: string[] = [];
        const enabledNames: string[] = [];

        for (const rawName of requested) {
            if (['all', 'default', 'unprivileged'].includes(rawName)) continue;

            const foundKey = Object.keys(INTENT_FLAGS).find(
                key => key.toLowerCase() === rawName.replace(/_/g, '').toLowerCase()
            );

            if (foundKey) {
                const flag = INTENT_FLAGS[foundKey as keyof typeof INTENT_FLAGS];
                bitfield.add(flag);
                enabledNames.push(foundKey);
            } else {
                errors.push(rawName);
            }
        }

        if (errors.length > 0) {
            const msg = `Invalid intent names provided: ${errors.join(', ')}`;
            log.error(msg);
            throw new Error(msg);
        }

        this.auditIntents(bitfield);

        return bitfield;
    }

    private auditIntents(bitfield: IntentsBitField): void {
        const activePrivileged: string[] = [];

        for (const flag of this.privileged) {
            if (bitfield.has(flag)) {
                const name = Object.keys(INTENT_FLAGS).find(
                    k => INTENT_FLAGS[k as keyof typeof INTENT_FLAGS] === flag
                );
                if (name) activePrivileged.push(name);
            }
        }

        if (activePrivileged.length > 0) {
            log.warn(
                `⚠️ PRIVILEGED INTENTS ENABLED: [${activePrivileged.join(', ')}]. ` +
                `Ensure these are toggled ON in the Discord Developer Portal, or the bot will fail to connect.`
            );
        }

        log.info(`Gateway Bitfield generated successfully (${bitfield.bitfield}).`);
    }
}

export const intentBuilder = new IntentBuilder();