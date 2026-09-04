import type { ButtonBuilder } from 'discord.js';
import type { PaginatorSession } from '../session/store.js';
import { sessionPagePayload } from '../session/store.js';
import { buildNavButtons, buildNavRow } from '../controls/buttons.js';
import { renderCv2Page } from '../render/cv2.js';
import { renderEmbedPage } from '../render/embed.js';

export function buildSessionMessagePayload(
    session: PaginatorSession,
    utilButtons?: ButtonBuilder[],
    showClose = false,
): Record<string, unknown> {
    const { text, meta } = sessionPagePayload(session);
    const nav = buildNavButtons({
        sessionId: session.id,
        page: meta.page,
        pages: meta.pages,
        utilCount: utilButtons?.length ?? 0,
        showClose,
    });

    if (session.mode === 'embed') {
        const rendered = renderEmbedPage({
            title: session.title,
            body: text,
            meta,
            accentColor: session.accentColor,
            navButtons: nav,
            utilButtons,
        });
        return {
            embeds: rendered.embeds,
            components: rendered.components,
            content: null,
        };
    }

    if (session.mode === 'content') {
        const rows = buildNavRow(nav, utilButtons);
        const header = `**${session.title ?? 'Results'}** (${meta.page}/${meta.pages})\n`;
        return {
            content: `${header}${text}`.slice(0, 2000),
            components: rows,
            embeds: [],
        };
    }

    const rendered = renderCv2Page({
        title: session.title,
        body: text,
        meta,
        accentColor: session.accentColor,
        navButtons: nav,
        utilButtons,
    });
    return {
        components: rendered.components,
        files: rendered.files,
        flags: rendered.flags,
        content: null,
        embeds: [],
    };
}
