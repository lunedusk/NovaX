import type { IHeart } from '#core/heart/index.js';
import type { RegisterRequirements } from '#core/loader/requirements.js';
import type { ChatInputCommandInteraction, Interaction } from 'discord.js';
import type { Request, Response, NextFunction } from 'express';

export type MiddlewarePhase = 'command' | 'event' | 'route' | 'handler';

export type MiddlewareResult = 'next' | 'stop';

export interface MiddlewareContext {
    readonly heart: IHeart;
    readonly pluginId: string;
    readonly phase: MiddlewarePhase;
    readonly interaction?: Interaction;
    readonly commandInteraction?: ChatInputCommandInteraction;
    readonly req?: Request;
    readonly res?: Response;
    readonly next?: NextFunction;
    readonly eventName?: string;
    readonly eventArgs?: readonly unknown[];
    readonly meta?: Record<string, unknown>;
}

export abstract class BaseMiddleware {
    public abstract readonly name: string;
    public readonly order: number = 100;
    public readonly phases: readonly MiddlewarePhase[] = ['command'];
    public readonly requirements?: RegisterRequirements;

    constructor(protected readonly heart: IHeart) {}

    public abstract run(ctx: MiddlewareContext): Promise<MiddlewareResult>;
}
