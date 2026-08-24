export interface CodecInfo {
    readonly name: string;
    readonly available: boolean;
}

export interface Codec<T = unknown> {
    readonly name: string;
    encode(obj: T): Buffer;
    decode(raw: Buffer): T;
}
