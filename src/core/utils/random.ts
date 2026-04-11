import { randomBytes, randomInt, randomUUID } from 'node:crypto';

export interface RandomConfig {
    alphabet?: string;
    urlsafeDefaultBytes?: number;
}

const DEFAULT_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export class Random {
    private readonly alphabet: string;
    private readonly urlsafeDefaultBytes: number;

    constructor(config: RandomConfig = {}) {
        this.alphabet = config.alphabet || DEFAULT_ALPHABET;
        this.urlsafeDefaultBytes = config.urlsafeDefaultBytes || 32;
    }

    public bytes(n: number): Buffer {
        if (!Number.isInteger(n) || n < 0) {
            throw new RangeError("Byte length must be a positive integer.");
        }
        if (n === 0) return Buffer.alloc(0);
        return randomBytes(n);
    }

    public hex(n: number): string {
        return this.bytes(n).toString('hex');
    }

    public token(bytes?: number): string {
        const bytesToGenerate = bytes ?? this.urlsafeDefaultBytes;
        return this.bytes(bytesToGenerate).toString('base64url');
    }
    public uuid4(): string {
        return randomUUID();
    }

    public integer(min: number, max: number): number {
        if (!Number.isInteger(min) || !Number.isInteger(max)) {
            throw new TypeError("Bounds must be integers.");
        }
        if (min > max) {
            throw new RangeError("Minimum value cannot be greater than maximum value.");
        }
        return randomInt(min, max + 1);
    }

    public string(length: number, customAlphabet?: string): string {
        if (!Number.isInteger(length) || length < 0) {
            throw new RangeError("String length must be a positive integer.");
        }
        if (length === 0) return '';

        const chars = customAlphabet || this.alphabet;
        if (chars.length === 0) {
            throw new RangeError("Alphabet must not be empty.");
        }

        let result = '';
        const charsLength = chars.length;
        
        for (let i = 0; i < length; i++) {
            result += chars[randomInt(0, charsLength)];
        }
        return result;
    }

    public choice<T>(array: T[]): T | undefined {
        if (!Array.isArray(array)) {
            throw new TypeError("Argument must be an array.");
        }
        if (array.length === 0) return undefined;
        if (array.length === 1) return array[0];

        const index = randomInt(0, array.length);
        return array[index];
    }

    public choices<T>(array: T[], count: number): T[] {
        if (!Array.isArray(array)) throw new TypeError("Argument must be an array.");
        if (count < 0 || count > array.length) {
            throw new RangeError("Count must be between 0 and array length.");
        }
        
        if (count === array.length) return this.shuffle([...array]);

        const pool = [...array];
        const result: T[] = [];
        
        for (let i = 0; i < count; i++) {
            const index = randomInt(0, pool.length);
            result.push(pool[index]);
            pool[index] = pool[pool.length - 1];
            pool.pop();
        }
        
        return result;
    }

    public shuffle<T>(array: T[]): T[] {
        if (!Array.isArray(array)) throw new TypeError("Argument must be an array.");
        
        let currentIndex = array.length;
        let randomIndex: number;

        while (currentIndex !== 0) {
            randomIndex = randomInt(0, currentIndex);
            currentIndex--;

            [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
        }

        return array;
    }
}

export const random = new Random();