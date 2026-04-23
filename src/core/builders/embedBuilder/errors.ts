export class EmbedEngineError extends Error {
    constructor(message: string, public readonly path?: string) {
        super(path ? `[EmbedEngine] ${message}  (at: ${path})` : `[EmbedEngine] ${message}`);
        this.name = "EmbedEngineError";
    }
}

export function assert(condition: unknown, message: string, path?: string): asserts condition {
    if (!condition) throw new EmbedEngineError(message, path);
}