import { getLogger } from '#core/utils/logger.js';
import { SemVer } from '#core/utils/semver.js';
import type { TagInfo } from './types.js';

const log = getLogger('Updater:GitHub');

export class GitHubClient {
    private readonly token: string | null;
    private readonly timeoutMs: number;

    constructor(token: string | null, timeoutMs = 30_000) {
        this.token = token;
        this.timeoutMs = timeoutMs;
    }

    private headers(): Record<string, string> {
        const h: Record<string, string> = {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'NovaX-Updater'
        };
        if (this.token) h.Authorization = `Bearer ${this.token}`;
        return h;
    }

    private async request<T>(url: string): Promise<T> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const res = await fetch(url, { headers: this.headers(), signal: controller.signal });

            if (res.status === 404) throw new Error(`GitHub resource not found: ${url}`);
            if (res.status === 401 || res.status === 403) {
                const body = await res.text().catch(() => '');
                throw new Error(
                    `GitHub auth/rate-limit error (${res.status}). ` +
                    `Provide GithubPat if the repository is private or rate-limited. Body: ${body.slice(0, 200)}`
                );
            }
            if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${await res.text().catch(() => '')}`);

            return (await res.json()) as T;
        } finally {
            clearTimeout(timer);
        }
    }

    static parseRepo(input: string): { owner: string; repo: string } {
        const cleaned = input.trim().replace(/\.git$/, '');
        const urlMatch = cleaned.match(/github\.com[/:]([^/]+)\/([^/]+)/i);
        if (urlMatch) return { owner: urlMatch[1], repo: urlMatch[2] };
        const short = cleaned.match(/^([^/]+)\/([^/]+)$/);
        if (short) return { owner: short[1], repo: short[2] };
        throw new Error(`Invalid repository identifier: "${input}". Expected owner/repo or GitHub URL.`);
    }

    async listTags(owner: string, repo: string): Promise<TagInfo[]> {
        const url = `https://api.github.com/repos/${owner}/${repo}/tags?per_page=100`;
        const raw = await this.request<Array<{ name: string; commit: { sha: string } }>>(url);

        return raw.map(t => {
            let semver: SemVer | null = null;
            try { semver = SemVer.parse(t.name); } catch {  }
            return { name: t.name, commit: t.commit.sha, semver };
        });
    }

    async getLatestAllowedTag(
        owner: string,
        repo: string,
        current: SemVer | null,
        devBuilds: boolean
    ): Promise<TagInfo | null> {
        const tags = (await this.listTags(owner, repo))
            .filter(t => t.semver !== null)
            .sort((a, b) => b.semver!.compare(a.semver!));

        for (const tag of tags) {
            if (!current) return tag;
            if (tag.semver!.isLessThanOrEqual(current)) continue;

            if (tag.semver!.major > current.major || tag.semver!.minor > current.minor) {
                return tag;
            }
            if (devBuilds && tag.semver!.patch > current.patch) {
                return tag;
            }
        }
        return null;
    }

    async findNearestTag(
        owner: string,
        repo: string,
        reference: SemVer | null
    ): Promise<TagInfo | null> {
        const tags = (await this.listTags(owner, repo))
            .filter(t => t.semver !== null)
            .sort((a, b) => b.semver!.compare(a.semver!));

        if (tags.length === 0) return null;
        if (!reference) return tags[0];

        const exact = tags.find(t => t.semver!.isEqual(reference));
        if (exact) return exact;

        let bestBelow: TagInfo | null = null;
        let bestAbove: TagInfo | null = null;

        for (const t of tags) {
            if (t.semver!.isLessThanOrEqual(reference)) {
                if (!bestBelow || t.semver!.isGreaterThan(bestBelow.semver!)) bestBelow = t;
            } else {
                if (!bestAbove || t.semver!.isLessThan(bestAbove.semver!)) bestAbove = t;
            }
        }

        return bestBelow ?? bestAbove ?? tags[0];
    }

    async downloadArchive(owner: string, repo: string, ref: string): Promise<Buffer> {
        const url = `https://codeload.github.com/${owner}/${repo}/tar.gz/${encodeURIComponent(ref)}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs * 3);

        try {
            const headers: Record<string, string> = { 'User-Agent': 'NovaX-Updater' };
            if (this.token) headers.Authorization = `Bearer ${this.token}`;

            const res = await fetch(url, { headers, signal: controller.signal });
            if (!res.ok) throw new Error(`Failed to download archive for ${ref}: HTTP ${res.status}`);
            return Buffer.from(await res.arrayBuffer());
        } finally {
            clearTimeout(timer);
        }
    }
}