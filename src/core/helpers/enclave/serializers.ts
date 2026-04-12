import { VaultConfigurationError } from './errors.js';
import { MAX_SERIALIZER_NAME } from './constants.js';

export interface Serializer<T = any> {
    name: string;
    encode(obj: T): Buffer;
    decode(raw: Buffer): T;
    retainsBufferReference?: boolean;
    isVolatile?: boolean;
}

export const Serializers = {
    json: {
        name: 'json',
        encode: (obj: any) => Buffer.from(JSON.stringify(obj), 'utf-8'),
        decode: (raw: Buffer) => JSON.parse(raw.toString('utf-8')),
        retainsBufferReference: false,
        isVolatile: true 
    } as Serializer<any>,
    text: {
        name: 'text',
        encode: (obj: string) => Buffer.from(obj, 'utf-8'),
        decode: (raw: Buffer) => raw.toString('utf-8'),
        retainsBufferReference: false,
        isVolatile: true
    } as Serializer<string>,
    bytes: {
        name: 'bytes',
        encode: (obj: Buffer) => obj,
        decode: (raw: Buffer) => Buffer.from(raw), 
        retainsBufferReference: false,
        isVolatile: false 
    } as Serializer<Buffer>
};

export function createFlatBufferSerializer<T>(
    name: string,
    encodeFn: (obj: T) => Uint8Array,
    decodeFn: (bytes: Uint8Array) => T
): Serializer<T> {
    if (!name || Buffer.byteLength(name) > MAX_SERIALIZER_NAME) {
        throw new VaultConfigurationError(`Invalid FlatBuffer serializer name: ${name}`);
    }
    
    return {
        name,
        encode: (obj: T) => Buffer.from(encodeFn(obj).buffer as ArrayBuffer, encodeFn(obj).byteOffset, encodeFn(obj).byteLength),
        decode: (raw: Buffer) => decodeFn(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)),
        retainsBufferReference: true,
        isVolatile: false 
    };
}