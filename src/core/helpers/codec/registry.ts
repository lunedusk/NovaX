import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { CodecError } from './errors.js';
import type { Codec, CodecInfo } from './types.js';

const require = createRequire(import.meta.url);

type MsgpackrPackr = {
    pack(value: unknown): Uint8Array | Buffer;
    unpack(buffer: Buffer | Uint8Array): unknown;
};

type CborModule = {
    encode(value: unknown): Buffer;
    decode(raw: Buffer): unknown;
};

class BinaryCodecRegistry {
    public static readonly instance = new BinaryCodecRegistry();

    readonly #codecs = new Map<string, Codec>();

    private constructor() {
        this.#registerBuiltinCodecs();
    }

    #registerBuiltinCodecs(): void {
        this.register({
            name: 'json',
            encode: (obj: unknown) => Buffer.from(JSON.stringify(obj)),
            decode: (raw: Buffer) => JSON.parse(raw.toString('utf-8')) as unknown,
        });

        try {
            const { Packr } = require('msgpackr') as { Packr: new (opts?: { useRecords?: boolean }) => MsgpackrPackr };
            const packr = new Packr({ useRecords: false });
            this.register({
                name: 'msgpack',
                encode: (obj: unknown) => {
                    const packed = packr.pack(obj);
                    return Buffer.isBuffer(packed) ? packed : Buffer.from(packed);
                },
                decode: (raw: Buffer) => packr.unpack(raw),
            });
        } catch {
        }

        try {
            const cbor = require('cbor') as CborModule;
            this.register({
                name: 'cbor',
                encode: (obj: unknown) => cbor.encode(obj),
                decode: (raw: Buffer) => cbor.decode(raw),
            });
        } catch {
        }
    }

    public register(codec: Codec): void {
        if (!codec?.name || typeof codec.name !== 'string' || codec.name.trim() === '') {
            throw new TypeError('Codec name must be a non-empty string');
        }
        if (typeof codec.encode !== 'function' || typeof codec.decode !== 'function') {
            throw new TypeError('Codec must provide valid encode and decode functions');
        }

        this.#codecs.set(codec.name, codec);
    }

    public unregister(name: string): boolean {
        if (name === 'json') {
            throw new CodecError('Cannot unregister the built-in JSON codec.');
        }
        return this.#codecs.delete(name);
    }

    public availableCodecs(): CodecInfo[] {
        const defaults = ['json', 'msgpack', 'cbor'];
        const out: CodecInfo[] = defaults.map((name) => ({
            name,
            available: this.#codecs.has(name),
        }));
        for (const name of this.#codecs.keys()) {
            if (!defaults.includes(name)) {
                out.push({ name, available: true });
            }
        }
        return out.sort((a, b) => a.name.localeCompare(b.name));
    }

    public encode<T = unknown>(obj: T, codecName: string = 'json'): Buffer {
        const codec = this.#codecs.get(codecName);
        if (!codec) {
            throw new CodecError(`Unknown or unavailable codec: ${codecName}`);
        }

        try {
            const data = codec.encode(obj);
            if (!Buffer.isBuffer(data)) {
                throw new CodecError(`Codec '${codecName}' encoder did not return a native Buffer`);
            }
            return data;
        } catch (error) {
            throw new CodecError(`Failed to encode with codec '${codecName}'`, { cause: error });
        }
    }

    public decode<T = unknown>(raw: Buffer, codecName: string = 'json'): T {
        if (!Buffer.isBuffer(raw)) {
            throw new TypeError('Raw input must be a native Buffer');
        }

        const codec = this.#codecs.get(codecName);
        if (!codec) {
            throw new CodecError(`Unknown or unavailable codec: ${codecName}`);
        }

        try {
            return codec.decode(raw) as T;
        } catch (error) {
            throw new CodecError(`Failed to decode with codec '${codecName}'`, { cause: error });
        }
    }
}

export const codecRegistry = Object.freeze(BinaryCodecRegistry.instance);
