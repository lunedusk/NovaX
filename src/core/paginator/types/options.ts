import type { ButtonBuilder } from 'discord.js';
import type { AtomicUnit, PagePayload, RenderMode } from './models.js';
import type { IHeart } from '#core/heart/index.js';

export interface SplitPolicy {
    readonly maxUnitsPerPage?: number;
    readonly preferUnits?: number;
}

export interface SessionPolicy {
    readonly ttlMs?: number;
    readonly authorOnly?: boolean;
    readonly maxPerUser?: number;
    readonly ephemeral?: boolean;
}

export interface NavPolicy {
    readonly utilButtons?: ButtonBuilder[];
    readonly showClose?: boolean;
    readonly showFirstLast?: boolean;
    readonly emojis?: {
        readonly first?: string;
        readonly prev?: string;
        readonly next?: string;
        readonly last?: string;
        readonly close?: string;
    };
}

export interface PaginatorCreateOptions {
    readonly heart: IHeart;
    readonly units: readonly AtomicUnit[];
    readonly mode?: RenderMode;
    readonly title?: string;
    readonly accentColor?: number;
    readonly initialPage?: number;
    readonly split?: SplitPolicy;
    readonly session?: SessionPolicy;
    readonly nav?: NavPolicy;
    readonly renderUnit?: (unit: AtomicUnit) => string;
    readonly renderPage?: (texts: readonly string[], meta: { page: number; pages: number; totalUnits: number }) => PagePayload;
}
