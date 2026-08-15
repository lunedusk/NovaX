import type { PluginSourceLine } from './types.js';

export function parsePluginsTxt(body: string): PluginSourceLine[] {
    const out: PluginSourceLine[] = [];
    const seen = new Set<string>();

    for (const line of body.split(/\r?\n/)) {
        const cleaned = line.replace(/#.*$/, '').trim();
        if (!cleaned) continue;

        const colon = cleaned.indexOf(':');
        if (colon > 0) {
            const id = cleaned.slice(0, colon).trim();
            let rest = cleaned.slice(colon + 1).trim();
            let pinnedTag: string | null = null;

            const at = rest.lastIndexOf('@');
            if (at > 0) {
                const maybeTag = rest.slice(at + 1).trim();
                if (/^[vV]?\d|\bplugin-/i.test(maybeTag) || /^[vV]?\d+\.\d+/.test(maybeTag)) {
                    pinnedTag = maybeTag;
                    rest = rest.slice(0, at).trim();
                }
            }

            let repo = rest;
            const urlMatch = rest.match(/github\.com[/:]([^/]+)\/([^/#\s]+)/i);
            if (urlMatch) {
                repo = `${urlMatch[1]}/${urlMatch[2].replace(/\.git$/, '')}`;
            }

            if (!id || !repo) continue;
            if (seen.has(id)) continue;
            seen.add(id);
            out.push({
                id,
                kind: 'external',
                repo,
                pinnedTag,
                raw: cleaned
            });
            continue;
        }

        const name = cleaned.startsWith('plugin-') ? cleaned.slice('plugin-'.length) : cleaned;
        if (!name) continue;
        if (seen.has(name)) continue;
        seen.add(name);
        out.push({
            id: name,
            kind: 'in-repo',
            repo: null,
            pinnedTag: null,
            raw: cleaned
        });
    }

    return out;
}