export class DiscordLimitError extends Error {
    readonly code = 'DISCORD_LIMIT';
    constructor(
        message: string,
        readonly field: string,
        readonly limit: number,
        readonly actual: number,
    ) {
        super(message);
        this.name = 'DiscordLimitError';
    }
}

export class DuplicateRegistrationError extends Error {
    readonly code = 'DUPLICATE_REGISTRATION';
    constructor(message: string) {
        super(message);
        this.name = 'DuplicateRegistrationError';
    }
}

export class StructureLockedError extends Error {
    readonly code = 'STRUCTURE_LOCKED';
    constructor(message: string) {
        super(message);
        this.name = 'StructureLockedError';
    }
}

const NAME_RE = /^[-_\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;

export function assertCommandName(name: string, kind: string): void {
    if (!name || name.length < 1 || name.length > 32) {
        throw new DiscordLimitError(
            `${kind} name length must be 1–32 (got ${name?.length ?? 0})`,
            'name.length',
            32,
            name?.length ?? 0,
        );
    }
    if (!NAME_RE.test(name)) {
        throw new DiscordLimitError(
            `${kind} name "${name}" contains invalid characters`,
            'name.charset',
            1,
            0,
        );
    }
}

export function assertDescription(description: string, kind: string): void {
    const len = description?.length ?? 0;
    if (len < 1 || len > 100) {
        throw new DiscordLimitError(
            `${kind} description length must be 1–100 (got ${len})`,
            'description.length',
            100,
            len,
        );
    }
}

export function assertSubcommandCount(count: number, scope: string): void {
    if (count > 25) {
        throw new DiscordLimitError(
            `${scope} exceeds 25 subcommands (got ${count})`,
            'subcommands',
            25,
            count,
        );
    }
}

export function assertGroupCount(count: number, scope: string): void {
    if (count > 25) {
        throw new DiscordLimitError(
            `${scope} exceeds 25 subcommand groups (got ${count})`,
            'subcommand_groups',
            25,
            count,
        );
    }
}

export function assertOptionCount(count: number, scope: string): void {
    if (count > 25) {
        throw new DiscordLimitError(
            `${scope} exceeds 25 options (got ${count})`,
            'options',
            25,
            count,
        );
    }
}
