import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { HASH_ALGORITHM } from './constants.js';

export interface FileHashResult {
    hash: string;
    size: number;
}

export async function hashFile(filePath: string): Promise<FileHashResult> {
    const hasher = createHash(HASH_ALGORITHM);
    let size = 0;

    await pipeline(
        createReadStream(filePath),
        async function* (source) {
            for await (const chunk of source) {
                const buf = chunk as Buffer;
                size += buf.length;
                hasher.update(buf);
                yield chunk;
            }
        }
    );

    return {
        hash: hasher.digest('hex'),
        size
    };
}

export function hashBuffer(data: Buffer | string): string {
    return createHash(HASH_ALGORITHM)
        .update(typeof data === 'string' ? Buffer.from(data, 'utf8') : data)
        .digest('hex');
}

export { HASH_ALGORITHM, SIGNATURE_LENGTH } from './constants.js';