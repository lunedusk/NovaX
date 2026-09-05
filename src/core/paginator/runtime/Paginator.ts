import type { ButtonInteraction, ChatInputCommandInteraction } from 'discord.js';
import type { ButtonBuilder } from 'discord.js';
import type { PaginatorCreateOptions } from '../types/options.js';
import type { AtomicUnit } from '../types/models.js';
import { defaultPackOptions, packAtomicUnits } from '../split/atomic.js';
import { newSessionId, parseNavCustomId } from '../controls/ids.js';
import { canAttachNav, paginationButtonBudget } from '../controls/capacity.js';
import {
    DEFAULT_MAX_PER_USER,
    DEFAULT_TTL,
    deleteSession,
    getSession,
    putSession,
    touchSession,
    type PaginatorSession,
} from '../session/store.js';
import { buildSessionMessagePayload } from './payload.js';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('Paginator');

export class Paginator {
    private readonly opts: PaginatorCreateOptions;
    private readonly pages;
    private readonly utilButtons: ButtonBuilder[] | undefined;

    constructor(options: PaginatorCreateOptions) {
        this.opts = options;
        this.utilButtons = options.nav?.utilButtons as ButtonBuilder[] | undefined;
        const mode = options.mode ?? 'cv2';
        const packDefaults = defaultPackOptions(mode === 'custom' ? 'cv2' : mode);
        this.pages = packAtomicUnits(options.units, {
            maxChars: packDefaults.maxChars,
            maxUnitsPerPage: options.split?.maxUnitsPerPage ?? packDefaults.maxUnitsPerPage,
            preferUnits: options.split?.preferUnits ?? packDefaults.preferUnits,
        });
    }

    public get pageCount(): number {
        return Math.max(1, this.pages.length);
    }

    public async reply(
        interaction: ChatInputCommandInteraction | ButtonInteraction,
    ): Promise<{ sessionId: string; pages: number }> {
        const mode = this.opts.mode ?? 'cv2';
        const sessionId = newSessionId();
        const ttl = this.opts.session?.ttlMs ?? DEFAULT_TTL;
        const packed = this.pages.length > 0 ? this.pages : [{ units: [] as AtomicUnit[], text: '\u200B' }];
        const maxPage = Math.max(1, packed.length);
        const startPage = Math.min(Math.max(1, this.opts.initialPage ?? 1), maxPage);
        const session: PaginatorSession = {
            id: sessionId,
            userId: interaction.user.id,
            channelId: interaction.channelId,
            mode: mode === 'custom' ? 'cv2' : mode,
            title: this.opts.title,
            accentColor: this.opts.accentColor,
            pages: packed,
            authorOnly: this.opts.session?.authorOnly ?? true,
            ephemeral: this.opts.session?.ephemeral ?? true,
            page: startPage,
            expiresAt: Date.now() + ttl,
        };
        putSession(session, this.opts.session?.maxPerUser ?? DEFAULT_MAX_PER_USER);

        const payload = buildSessionMessagePayload(
            session,
            this.utilButtons,
            this.opts.nav?.showClose ?? false,
        );
        const ephemeral = session.ephemeral;

        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(payload as never);
        } else {
            await interaction.reply({ ...(payload as object), ephemeral } as never);
        }

        return { sessionId, pages: this.pageCount };
    }

    public static async handleButton(interaction: ButtonInteraction): Promise<boolean> {
        const parsed = parseNavCustomId(interaction.customId);
        if (!parsed) return false;

        const langMsg = async (code: 'PAGINATOR_EXPIRED' | 'PAGINATOR_AUTHOR_ONLY' | 'PAGINATOR_CLOSED'): Promise<string> => {
            try {
                const { coreErrorMessage } = await import('#plugins/core/src/lib/coreErrors.js');
                return coreErrorMessage(code);
            } catch {
                if (code === 'PAGINATOR_EXPIRED') return 'This menu expired.';
                if (code === 'PAGINATOR_AUTHOR_ONLY') return 'Only the command author can use these controls.';
                return 'Closed.';
            }
        };

        const session = getSession(parsed.sessionId);
        if (!session) {
            const content = await langMsg('PAGINATOR_EXPIRED');
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content, ephemeral: true }).catch(() => undefined);
            } else {
                await interaction.reply({ content, ephemeral: true }).catch(() => undefined);
            }
            return true;
        }

        if (session.authorOnly && interaction.user.id !== session.userId) {
            await interaction.reply({ content: await langMsg('PAGINATOR_AUTHOR_ONLY'), ephemeral: true }).catch(() => undefined);
            return true;
        }

        touchSession(session.id);

        if (parsed.action === 'close') {
            deleteSession(session.id);
            await interaction.update({ components: [], content: await langMsg('PAGINATOR_CLOSED'), embeds: [] }).catch(() => undefined);
            return true;
        }

        const pages = Math.max(1, session.pages.length);
        let page = session.page;
        switch (parsed.action) {
            case 'first':
                page = 1;
                break;
            case 'prev':
                page = Math.max(1, page - 1);
                break;
            case 'next':
                page = Math.min(pages, page + 1);
                break;
            case 'last':
                page = pages;
                break;
            default:
                break;
        }
        session.page = page;

        const payload = buildSessionMessagePayload(session, undefined, false);
        await interaction.update(payload as never).catch((err: unknown) => {
            log.warn(`paginator update failed: ${err instanceof Error ? err.message : String(err)}`);
        });
        return true;
    }
}

export function unitsFromLines(lines: readonly string[], idPrefix = 'l'): AtomicUnit[] {
    return lines.map((text, i) => ({ id: `${idPrefix}:${i}`, text }));
}

export function canPaginateWithNav(utilCount: number): boolean {
    const need = utilCount > 0 ? 2 : 3;
    return canAttachNav({
        neededButtons: need,
        existingRowCount: 0,
        existingButtonCount: 0,
        utilButtons: utilCount > 0 ? (Array.from({ length: utilCount }) as never) : undefined,
    });
}

export function maxPaginationButtons(utilCount: number): number {
    return paginationButtonBudget(utilCount);
}
