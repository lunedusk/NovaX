import { createRequire } from 'node:module';

export type Operation = {
    op: string;
    path: string;
    from?: string;
    value?: unknown;
};

type JsonPatchApi = {
    applyPatch: (
        document: object,
        patch: readonly Operation[],
        validateOperation?: boolean | object[],
        mutateDocument?: boolean,
        banPrototypeModifications?: boolean,
    ) => { newDocument: object };
    compare: (tree1: object, tree2: object) => Operation[];
};

function loadJsonPatch(): JsonPatchApi {
    try {
        const require = createRequire(import.meta.url);
        const mod = require('fast-json-patch') as JsonPatchApi & { default?: JsonPatchApi };
        if (typeof mod.applyPatch === 'function' && typeof mod.compare === 'function') {
            return mod;
        }
        if (mod.default && typeof mod.default.applyPatch === 'function') {
            return mod.default;
        }
    } catch {

    }
    throw new Error(
        "Unable to load fast-json-patch. Ensure dependency is installed (npm i fast-json-patch).",
    );
}

const jsonpatch = loadJsonPatch();

export function applyPatch(
    document: object,
    patch: readonly Operation[],
    validateOperation?: boolean | object[],
    mutateDocument?: boolean,
): { newDocument: object } {
    return jsonpatch.applyPatch(document, patch, validateOperation, mutateDocument);
}

export function compare(tree1: object, tree2: object): Operation[] {
    return jsonpatch.compare(tree1, tree2);
}
