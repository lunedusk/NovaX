export class ComponentV2Error extends Error {
    constructor(message: string, public readonly path?: string) {
        super(path ? `[ComponentsV2] ${message}  (at: ${path})` : `[ComponentsV2] ${message}`);
        this.name = "ComponentV2Error";
    }
}

export function assert(condition: unknown, message: string, path?: string): asserts condition {
    if (!condition) throw new ComponentV2Error(message, path);
}

export function assertNever(x: never, message: string): never {
    throw new ComponentV2Error(message);
}