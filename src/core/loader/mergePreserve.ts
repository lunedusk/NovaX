export type JsonObject = Record<string, unknown>;

export function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function typeTag(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}

function isPlainObject(value: unknown): value is JsonObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pathJoin(parent: string, key: string): string {
    return parent === 'root' ? key : `${parent}.${key}`;
}

export function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null) return a === b;
    if (typeof a !== typeof b) return false;
    if (Array.isArray(a)) {
        if (!Array.isArray(b) || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (!deepEqual(a[i], b[i])) return false;
        }
        return true;
    }
    if (typeof a === 'object') {
        if (typeof b !== 'object' || Array.isArray(b)) return false;
        const ao = a as JsonObject;
        const bo = b as JsonObject;
        const aKeys = Object.keys(ao);
        const bKeys = Object.keys(bo);
        if (aKeys.length !== bKeys.length) return false;
        for (const key of aKeys) {
            if (!Object.prototype.hasOwnProperty.call(bo, key)) return false;
            if (!deepEqual(ao[key], bo[key])) return false;
        }
        return true;
    }
    return false;
}

export function mergePreserve(
    defaultObj: unknown,
    userObj: unknown,
    pathTracker: string = 'root',
    mutations: string[] = [],
): unknown {
    if (userObj === undefined) {
        if (pathTracker !== 'root') {
            mutations.push(`[Missing Key] Added '${pathTracker}'`);
        }
        return cloneJson(defaultObj);
    }

    if (isPlainObject(defaultObj) && isPlainObject(userObj)) {
        const out: JsonObject = {};
        for (const key of Object.keys(userObj)) {
            if (Object.prototype.hasOwnProperty.call(defaultObj, key)) {
                out[key] = mergePreserve(
                    defaultObj[key],
                    userObj[key],
                    pathJoin(pathTracker, key),
                    mutations,
                );
            } else {
                out[key] = userObj[key];
            }
        }
        for (const key of Object.keys(defaultObj)) {
            if (!Object.prototype.hasOwnProperty.call(out, key)) {
                mutations.push(`[Missing Key] Added '${pathJoin(pathTracker, key)}'`);
                out[key] = cloneJson(defaultObj[key]);
            }
        }
        return out;
    }

    if (Array.isArray(defaultObj) && Array.isArray(userObj)) {
        return userObj;
    }

    if (typeTag(defaultObj) !== typeTag(userObj)) {
        mutations.push(
            `[Type Mismatch] kept user value at '${pathTracker}' (${typeTag(userObj)} vs default ${typeTag(defaultObj)})`,
        );
    }

    return userObj;
}

export function mergePreserveObject(
    defaultObj: JsonObject,
    userObj: JsonObject,
    mutations: string[] = [],
): JsonObject {
    return mergePreserve(defaultObj, userObj, 'root', mutations) as JsonObject;
}
