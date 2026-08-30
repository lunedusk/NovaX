import { pack, unpack } from 'msgpackr';

export function encodeMessage(value: unknown): Buffer {
    return Buffer.from(pack(value));
}

export function decodeMessage<T = unknown>(raw: Buffer | Uint8Array): T {
    return unpack(raw) as T;
}
