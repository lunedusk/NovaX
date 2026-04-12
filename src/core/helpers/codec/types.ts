export interface CodecInfo {
    readonly name: string;
    readonly available: boolean;
}

export interface Codec<T = any> {
    readonly name: string;
    encode(obj: T): Buffer;
    decode(raw: Buffer): T;
}