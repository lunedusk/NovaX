import { scrypt } from 'node:crypto';
import { brotliCompress, brotliDecompress, BrotliOptions } from 'node:zlib';

export const scryptAsync = (password: any, salt: any, keylen: number, options: any): Promise<Buffer> =>
    new Promise((resolve, reject) => scrypt(password, salt, keylen, options, (err, key) => err ? reject(err) : resolve(Buffer.from(key))));

export const compressAsync = (buffer: any, options: BrotliOptions): Promise<Buffer> =>
    new Promise((resolve, reject) => brotliCompress(buffer, options, (err, result) => err ? reject(err) : resolve(Buffer.from(result))));

export const decompressAsync = (buffer: any): Promise<Buffer> =>
    new Promise((resolve, reject) => brotliDecompress(buffer, (err, result) => err ? reject(err) : resolve(Buffer.from(result))));