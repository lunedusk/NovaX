import { AttachmentBuilder } from "discord.js";

export interface AttachmentInput {
    name: string;
    data: Buffer | string;
    spoiler?: boolean;
}

export class AssetManager {
    private files = new Map<string, AttachmentBuilder>();
    private inputs: Record<string, AttachmentInput>;

    constructor(inputs: Record<string, AttachmentInput> = {}) {
        this.inputs = inputs;
    }

    public getAttachment(url: string, path: string, strict: boolean): AttachmentBuilder | null {
        if (!url.startsWith("attachment://")) return null;
        const name = url.slice("attachment://".length);
        if (!name) return null;

        if (this.files.has(name)) return this.files.get(name)!;

        const input = this.inputs[name];
        if (!input) {
            if (strict) {
                throw new Error(`[AssetManager] Missing attachment for "${name}" at ${path}`);
            }
            console.warn(`[AssetManager] Warning: Missing attachment for "${name}" at ${path}.`);
            return null;
        }

        const att = new AttachmentBuilder(input.data).setName(input.name);
        if (input.spoiler) att.setSpoiler(true);
        this.files.set(name, att);
        return att;
    }

    public exportFiles(): AttachmentBuilder[] {
        return Array.from(this.files.values());
    }
}
