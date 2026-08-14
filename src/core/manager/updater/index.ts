import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getLogger } from '#core/utils/logger.js';
import { secrets } from '#core/helpers/secretManager.js';
import { SemVer, SemVerRange } from '#core/utils/semver.js';
import { GitHubClient } from './github.js';
import { hashFile } from '#core/helpers/hash/index.js';
import type {
    Baseline,
    BaselineFileEntry,
    DirtyFile,
    PluginDecision,
    UpdatePlan,
    UpdaterConfig,
    TagInfo
} from './types.js';

const execFileAsync = promisify(execFile);
const log = getLogger('Updater');

const STATE_DIR   = path.join(process.cwd(), '.data', 'updater');
const BASELINE    = path.join(STATE_DIR, 'baseline.json');
const BACKUP_DIR  = path.join(STATE_DIR, 'backups');
const STAGING_DIR = path.join(STATE_DIR, 'staging');

const HARD_EXCLUDES = new Set([
    'node_modules', '.git', '.data', 'logs', 'configuration',
    '.env', '.env.local', 'common.json'
]);

function loadConfig(): UpdaterConfig {
    return {
        autoUpdater:    secrets.getBoolean('AutoUpdater', true),
        repositoryUrl:  secrets.getOptional('RepositoryUrl') || null,
        githubPat:      secrets.getOptional('GithubPat') || secrets.getOptional('GH_TOKEN') || null,
        defaultRepo:    secrets.getOptional('UpdaterDefaultRepo') || 'lunedusk/NovaX',
        branch:         secrets.getOptional('UpdaterBranch') || 'main',
        devBuilds:      secrets.getBoolean('DevBuilds', false),
        safeUpdate:     secrets.getBoolean('SafeUpdate', true),
        keepExtra:      secrets.getBoolean('UpdaterKeepExtra', true),
        allowForce:     secrets.getBoolean('UpdaterAllowForce', false),
        dryRun:         secrets.getBoolean('UpdaterDryRun', false),
        maxBackups:     parseInt(secrets.getOptional('UpdaterMaxBackups') || '3', 10),
        timeoutMs:      parseInt(secrets.getOptional('UpdaterTimeoutMs') || '300000', 10),
        postUpdateCmd:  secrets.getOptional('UpdaterPostUpdateCmd') || null,
        notifyChannel:  secrets.getOptional('UpdaterNotifyChannel') || null,
        pluginManifest: secrets.getOptional('UpdaterPluginManifest') || 'manifest.json',
        mode:           (secrets.getOptional('UpdaterMode') as 'standalone' | 'background') || 'standalone'
    };
}

function ensureDirs(): void {
    for (const d of [STATE_DIR, BACKUP_DIR, STAGING_DIR]) {
        fs.mkdirSync(d, { recursive: true });
    }
}

function readBaseline(): Baseline | null {
    try {
        if (!fs.existsSync(BASELINE)) return null;
        return JSON.parse(fs.readFileSync(BASELINE, 'utf-8')) as Baseline;
    } catch {
        log.warn('Baseline unreadable – treating as missing');
        return null;
    }
}

function writeBaseline(b: Baseline): void {
    ensureDirs();
    fs.writeFileSync(BASELINE, JSON.stringify(b, null, 2), 'utf-8');
    log.info(`Baseline written for tag ${b.tag}`);
}

function isPluginPath(rel: string): boolean {
    const n = rel.replace(/\\/g, '/');
    return n.startsWith('src/plugins/') || n.startsWith('plugins/');
}

function pluginRoot(rel: string): string | null {
    const n = rel.replace(/\\/g, '/');
    const m = n.match(/^(src\/plugins\/[^/]+|plugins\/[^/]+)/);
    return m ? m[1] : null;
}

function shouldHardExclude(rel: string): boolean {
    const parts = rel.replace(/\\/g, '/').split('/');
    return parts.some(p => HARD_EXCLUDES.has(p)) || rel.startsWith('.');
}

function walkLocal(root = process.cwd()): string[] {
    const results: string[] = [];
    const skip = new Set(['node_modules', '.git', '.data', 'logs', 'configuration']);

    function recurse(dir: string, relBase: string) {
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const ent of entries) {
            if (skip.has(ent.name) || ent.name.startsWith('.')) continue;
            const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) recurse(full, rel);
            else if (ent.isFile()) results.push(rel.replace(/\\/g, '/'));
        }
    }
    recurse(root, '');
    return results;
}

async function computeLocalHashes(files: string[]): Promise<Record<string, BaselineFileEntry>> {
    const out: Record<string, BaselineFileEntry> = {};
    for (const rel of files) {
        const full = path.join(process.cwd(), rel);
        try {
            const { hash, size } = await hashFile(full);
            out[rel] = { hash, size };
        } catch { /* skip */ }
    }
    return out;
}

function readPackageVersion(): SemVer | null {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'));
        return SemVer.parse(pkg.version);
    } catch {
        return null;
    }
}

function parsePluginsTxt(body: string): string[] {
    const names: string[] = [];
    for (const line of body.split(/\r?\n/)) {
        const cleaned = line.replace(/#.*$/, '').trim();
        if (!cleaned) continue;
        const name = cleaned.startsWith('plugin-') ? cleaned.slice('plugin-'.length) : cleaned;
        if (name) names.push(name);
    }
    return names;
}

function localPluginDir(pluginName: string): string | null {
    const candidates = [
        path.join('src', 'plugins', pluginName),
        path.join('plugins', pluginName)
    ];
    for (const c of candidates) {
        if (fs.existsSync(path.join(process.cwd(), c))) return c.replace(/\\/g, '/');
    }
    return null;
}

function readLocalManifestId(pluginRel: string, manifestName: string): string | undefined {
    const p = path.join(process.cwd(), pluginRel, manifestName);
    if (!fs.existsSync(p)) return undefined;
    try {
        const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
        return j.id || j.name;
    } catch {
        return undefined;
    }
}

function manifestCompatible(manifestJson: string, coreVersion: SemVer): { ok: boolean; req: string } {
    try {
        const manifest = JSON.parse(manifestJson);
        const req: string =
            manifest.novax_version ||
            (manifest.engines && manifest.engines.novax) ||
            '*';
        const ok = SemVerRange.satisfies(coreVersion.toString(), req);
        return { ok, req: String(req) };
    } catch {
        return { ok: false, req: '?' };
    }
}

export class Updater {
    private readonly config: UpdaterConfig;
    private readonly gh: GitHubClient;

    constructor() {
        this.config = loadConfig();
        this.gh = new GitHubClient(this.config.githubPat, Math.min(this.config.timeoutMs, 60_000));
    }

    async run(options: {
        force?: boolean;
        dryRun?: boolean;
        baselineOnly?: boolean;
        installPlugin?: string | null;
    } = {}): Promise<UpdatePlan> {
        ensureDirs();
        const force         = options.force ?? false;
        const dryRun        = options.dryRun ?? this.config.dryRun;
        const baselineOnly  = options.baselineOnly ?? false;
        const installPlugin = this.normalizePluginArg(options.installPlugin ?? null);

        log.info(
            `Updater start (baselineOnly=${baselineOnly}, dryRun=${dryRun}, force=${force}, installPlugin=${installPlugin ?? '-'})`
        );

        let owner: string;
        let repo: string;

        if (this.config.repositoryUrl) {
            try {
                ({ owner, repo } = GitHubClient.parseRepo(this.config.repositoryUrl));
            } catch (e) {
                log.warn(`RepositoryUrl invalid – aborting: ${(e as Error).message}`);
                return this.emptyPlan('Invalid RepositoryUrl', baselineOnly, installPlugin);
            }
        } else {
            ({ owner, repo } = GitHubClient.parseRepo(this.config.defaultRepo));
        }
        log.info(`Repository: ${owner}/${repo}`);

        const baseline = readBaseline();
        let currentSemVer: SemVer | null = null;
        if (baseline) {
            try { currentSemVer = SemVer.parse(baseline.tag); } catch { /* ignore */ }
        }
        if (!currentSemVer) currentSemVer = readPackageVersion();

        if (baselineOnly) {
            let target: TagInfo | null;
            try {
                target = await this.gh.findNearestTag(owner, repo, currentSemVer);
            } catch (e) {
                if (this.config.repositoryUrl) {
                    return this.emptyPlan(`RepositoryUrl unreachable: ${(e as Error).message}`, true, installPlugin);
                }
                throw e;
            }
            if (!target?.semver) return this.emptyPlan('No suitable tag', true, installPlugin);
            const stagingRoot = await this.stageArchive(owner, repo, target.name);
            const remoteFiles = this.collectRemoteFiles(stagingRoot);
            return this.runBaselineOnly({
                target, stagingRoot, remoteFiles, dryRun, force
            });
        }

        let coreTarget: TagInfo | null = null;
        try {
            coreTarget = await this.gh.getLatestAllowedTag(owner, repo, currentSemVer, this.config.devBuilds);
        } catch (e) {
            if (this.config.repositoryUrl) {
                return this.emptyPlan(`RepositoryUrl unreachable: ${(e as Error).message}`, false, installPlugin);
            }
            throw e;
        }

        let coreForCompat: SemVer | null =
            coreTarget?.semver ?? currentSemVer ?? readPackageVersion();

        const pluginsTxtRef = coreTarget?.name ?? baseline?.tag ?? null;
        let officialPluginNames: string[] = [];
        if (pluginsTxtRef) {
            const body = await this.gh.getFileText(owner, repo, pluginsTxtRef, 'plugins.txt');
            if (body) {
                officialPluginNames = parsePluginsTxt(body);
                log.info(`Tag ${pluginsTxtRef} plugins.txt → ${officialPluginNames.length} plugin(s)`);
            } else {
                log.info(`No plugins.txt on ref ${pluginsTxtRef} – no plugin updates from list`);
            }
        }

        if (installPlugin) {
            if (!pluginsTxtRef || officialPluginNames.length === 0 || !coreForCompat) {
                const tags = (await this.gh.listTags(owner, repo))
                    .filter(t => t.semver !== null)
                    .sort((a, b) => b.semver!.compare(a.semver!));
                const latest = tags[0] ?? null;
                if (latest) {
                    coreForCompat = coreForCompat ?? latest.semver;
                    const body = await this.gh.getFileText(owner, repo, latest.name, 'plugins.txt');
                    if (body) officialPluginNames = parsePluginsTxt(body);
                    if (!coreTarget) coreTarget = latest;
                }
            }
            return this.runInstallPlugin({
                owner, repo, pluginName: installPlugin,
                officialPluginNames, coreForCompat, baseline,
                dryRun, force, coreTarget
            });
        }

        if (!coreTarget?.semver) {
            log.info('No newer core tag. Checking plugins against current core only…');
            const pluginDecisions = await this.planPluginUpdates({
                owner, repo,
                officialPluginNames,
                coreForCompat: coreForCompat!,
                baseline,
                force,
                allowAdd: false
            });
            const toApply = pluginDecisions.filter(d => d.action === 'update' || d.action === 'add');
            if (toApply.length === 0) {
                return this.emptyPlan('No suitable core tag and no plugin updates', false, null);
            }
            const plan: UpdatePlan = {
                fromTag: baseline?.tag ?? null,
                toTag: baseline?.tag ?? currentSemVer?.toString() ?? '',
                toCommit: baseline?.commit ?? '',
                allowed: true,
                reason: 'Plugin-only updates (core already current)',
                dirtyFiles: [],
                pluginDecisions,
                filesToOverwrite: [],
                filesToAdd: [],
                filesToKeep: [],
                dryRun,
                baselineOnly: false,
                installPlugin: null
            };
            this.printPlan(plan);
            if (dryRun) return plan;
            await this.applyPluginDecisions(owner, repo, toApply, force);
            await this.refreshBaselineAfterPlugins(baseline, toApply);
            this.pruneBackups();
            return plan;
        }

        const stagingRoot = await this.stageArchive(owner, repo, coreTarget.name);
        const remoteFiles = this.collectRemoteFiles(stagingRoot);
        const remoteSet = new Set(remoteFiles);
        const localFiles = walkLocal().filter(f => !shouldHardExclude(f));

        const dirtyCore: DirtyFile[] = [];
        if (this.config.safeUpdate && baseline && !force) {
            for (const [rel, entry] of Object.entries(baseline.files)) {
                if (isPluginPath(rel)) continue;
                if (shouldHardExclude(rel)) continue;
                const full = path.join(process.cwd(), rel);
                if (!fs.existsSync(full)) continue;
                try {
                    const current = await hashFile(full);
                    if (current.hash !== entry.hash) {
                        dirtyCore.push({
                            path: rel,
                            baselineHash: entry.hash,
                            currentHash: current.hash,
                            category: 'core'
                        });
                    }
                } catch { /* ignore */ }
            }
        }

        if (dirtyCore.length > 0 && this.config.safeUpdate && !force) {
            log.warn(`SafeUpdate blocked core update – ${dirtyCore.length} modified core file(s):`);
            for (const d of dirtyCore.slice(0, 15)) log.warn(`  • ${d.path}`);
            return {
                fromTag: baseline?.tag ?? null,
                toTag: coreTarget.name,
                toCommit: coreTarget.commit,
                allowed: false,
                reason: `SafeUpdate blocked: ${dirtyCore.length} user-modified core file(s)`,
                dirtyFiles: dirtyCore,
                pluginDecisions: [],
                filesToOverwrite: [],
                filesToAdd: [],
                filesToKeep: [],
                dryRun,
                baselineOnly: false,
                installPlugin: null
            };
        }

        const filesToOverwrite: string[] = [];
        const filesToAdd: string[] = [];
        const filesToKeep: string[] = [];

        for (const rel of localFiles) {
            if (isPluginPath(rel)) continue;
            if (remoteSet.has(rel)) filesToOverwrite.push(rel);
            else if (this.config.keepExtra) filesToKeep.push(rel);
        }
        for (const rel of remoteFiles) {
            if (isPluginPath(rel)) continue;
            if (!localFiles.includes(rel)) filesToAdd.push(rel);
        }

        const pluginDecisions = await this.planPluginUpdates({
            owner, repo,
            officialPluginNames,
            coreForCompat: coreTarget.semver,
            baseline,
            force,
            allowAdd: false
        });

        const plan: UpdatePlan = {
            fromTag: baseline?.tag ?? null,
            toTag: coreTarget.name,
            toCommit: coreTarget.commit,
            allowed: true,
            reason: `Update to ${coreTarget.name}`,
            dirtyFiles: dirtyCore,
            pluginDecisions,
            filesToOverwrite,
            filesToAdd,
            filesToKeep,
            dryRun,
            baselineOnly: false,
            installPlugin: null
        };
        this.printPlan(plan);

        if (dryRun) {
            log.info('Dry-run – no changes written.');
            return plan;
        }

        await this.createBackup(baseline?.tag ?? 'unknown');
        await this.applyCoreFromStaging(stagingRoot, plan);
        await this.rebuild();

        const pluginsToApply = pluginDecisions.filter(d => d.action === 'update' || d.action === 'add');
        await this.applyPluginDecisions(owner, repo, pluginsToApply, force);

        const managedCore = [...filesToOverwrite, ...filesToAdd];
        const newHashes = await computeLocalHashes(managedCore);
        const mergedFiles: Record<string, BaselineFileEntry> = { ...newHashes };
        if (baseline) {
            for (const [rel, entry] of Object.entries(baseline.files)) {
                if (!isPluginPath(rel)) continue;
                const root = pluginRoot(rel);
                const skipped = pluginDecisions.some(
                    d => d.action === 'leave' || d.action === 'skip'
                ) && root && pluginDecisions.some(
                    d => (d.localPath === root || d.pluginId === root.split('/').pop()) &&
                        (d.action === 'leave' || d.action === 'skip')
                );
                if (skipped && !mergedFiles[rel]) mergedFiles[rel] = entry;
            }
        }
        for (const d of pluginsToApply) {
            const root = d.localPath || `src/plugins/${d.pluginId}`;
            const files = walkLocal(path.join(process.cwd(), root)).map(
                f => path.join(root, f).replace(/\\/g, '/')
            );
        }
        const allLocal = walkLocal().filter(f => !shouldHardExclude(f));
        for (const d of pluginsToApply) {
            const root = (d.localPath || `src/plugins/${d.pluginId}`).replace(/\\/g, '/');
            const pluginFiles = allLocal.filter(f => f === root || f.startsWith(root + '/'));
            Object.assign(mergedFiles, await computeLocalHashes(pluginFiles));
        }

        writeBaseline({
            tag: coreTarget.name,
            commit: coreTarget.commit,
            timestamp: new Date().toISOString(),
            files: mergedFiles
        });

        if (this.config.postUpdateCmd) {
            try {
                await execFileAsync('bash', ['-c', this.config.postUpdateCmd], {
                    cwd: process.cwd(), timeout: 60_000
                });
            } catch (e) {
                log.error('Post-update command failed', e);
            }
        }
        this.pruneBackups();
        log.info(`Update to ${coreTarget.name} completed.`);
        return plan;
    }

    private normalizePluginArg(raw: string | null): string | null {
        if (!raw) return null;
        const t = raw.trim();
        if (!t) return null;
        return t.startsWith('plugin-') ? t.slice('plugin-'.length) : t;
    }

    private async planPluginUpdates(ctx: {
        owner: string;
        repo: string;
        officialPluginNames: string[];
        coreForCompat: SemVer;
        baseline: Baseline | null;
        force: boolean;
        allowAdd: boolean;
        onlyName?: string;
    }): Promise<PluginDecision[]> {
        const decisions: PluginDecision[] = [];
        const names = ctx.onlyName
            ? ctx.officialPluginNames.filter(n => n === ctx.onlyName)
            : ctx.officialPluginNames;

        for (const pluginName of names) {
            const localRel = localPluginDir(pluginName);

            if (!localRel && !ctx.allowAdd) {
                decisions.push({
                    pluginId: pluginName,
                    localPath: `src/plugins/${pluginName}`,
                    remotePath: null,
                    action: 'skip',
                    reason: 'Not installed locally – auto-install disabled (use --install-plugin)'
                });
                continue;
            }

            const tags = await this.gh.listPluginTags(ctx.owner, ctx.repo, pluginName);
            if (tags.length === 0) {
                decisions.push({
                    pluginId: pluginName,
                    localPath: localRel ?? `src/plugins/${pluginName}`,
                    remotePath: null,
                    action: 'skip',
                    reason: `No tags matching plugin-${pluginName}-v* (branch fallback disabled)`
                });
                continue;
            }

            let selected: TagInfo | null = null;
            let selectedReq = '';
            for (const tag of tags) {
                const manifestPath = `src/plugins/${pluginName}/${this.config.pluginManifest}`;
                const text = await this.gh.getFileText(ctx.owner, ctx.repo, tag.name, manifestPath);
                if (!text) continue;
                const { ok, req } = manifestCompatible(text, ctx.coreForCompat);
                if (ok) {
                    selected = tag;
                    selectedReq = req;
                    break;
                }
                log.info(`  plugin ${pluginName}: ${tag.name} incompatible (requires ${req})`);
            }

            if (!selected) {
                decisions.push({
                    pluginId: pluginName,
                    localPath: localRel ?? `src/plugins/${pluginName}`,
                    remotePath: null,
                    action: 'skip',
                    reason: 'No compatible plugin tag for current core version'
                });
                continue;
            }

            const remoteMan = await this.gh.getFileText(
                ctx.owner, ctx.repo, selected.name,
                `src/plugins/${pluginName}/${this.config.pluginManifest}`
            );
            let remoteId: string | undefined;
            try {
                if (remoteMan) {
                    const j = JSON.parse(remoteMan);
                    remoteId = j.id || j.name;
                }
            } catch { /* ignore */ }

            if (localRel) {
                const localId = readLocalManifestId(localRel, this.config.pluginManifest);
                if (localId && remoteId && localId !== remoteId) {
                    decisions.push({
                        pluginId: pluginName,
                        localPath: localRel,
                        remotePath: `src/plugins/${pluginName}`,
                        action: 'leave',
                        reason: `id mismatch (local="${localId}" vs remote="${remoteId}")`,
                        localManifestId: localId,
                        remoteManifestId: remoteId,
                        selectedPluginTag: selected.name
                    });
                    continue;
                }

                if (this.config.safeUpdate && !ctx.force && ctx.baseline) {
                    const dirty = await this.isPluginDirty(localRel, ctx.baseline);
                    if (dirty) {
                        decisions.push({
                            pluginId: pluginName,
                            localPath: localRel,
                            remotePath: `src/plugins/${pluginName}`,
                            action: 'leave',
                            reason: 'SafeUpdate: local plugin files differ from baseline',
                            localManifestId: localId,
                            remoteManifestId: remoteId,
                            selectedPluginTag: selected.name
                        });
                        continue;
                    }
                }

                decisions.push({
                    pluginId: pluginName,
                    localPath: localRel,
                    remotePath: `src/plugins/${pluginName}`,
                    action: 'update',
                    reason: `Compatible tag ${selected.name} (requires ${selectedReq})`,
                    localManifestId: localId,
                    remoteManifestId: remoteId,
                    selectedPluginTag: selected.name
                });
            } else {
                // allowAdd path (--install-plugin)
                decisions.push({
                    pluginId: pluginName,
                    localPath: `src/plugins/${pluginName}`,
                    remotePath: `src/plugins/${pluginName}`,
                    action: 'add',
                    reason: `Install from ${selected.name} (requires ${selectedReq})`,
                    remoteManifestId: remoteId,
                    selectedPluginTag: selected.name
                });
            }
        }

        return decisions;
    }

    private async isPluginDirty(pluginRel: string, baseline: Baseline): Promise<boolean> {
        const prefix = pluginRel.replace(/\\/g, '/');
        for (const [rel, entry] of Object.entries(baseline.files)) {
            if (rel !== prefix && !rel.startsWith(prefix + '/')) continue;
            const full = path.join(process.cwd(), rel);
            if (!fs.existsSync(full)) continue;
            try {
                const cur = await hashFile(full);
                if (cur.hash !== entry.hash) return true;
            } catch { /* ignore */ }
        }
        return false;
    }

    private async runInstallPlugin(ctx: {
        owner: string;
        repo: string;
        pluginName: string;
        officialPluginNames: string[];
        coreForCompat: SemVer | null;
        baseline: Baseline | null;
        dryRun: boolean;
        force: boolean;
        coreTarget: TagInfo | null;
    }): Promise<UpdatePlan> {
        const { pluginName, officialPluginNames, dryRun, force } = ctx;

        if (!ctx.coreForCompat) {
            return this.emptyPlan('Cannot resolve core version for plugin compatibility', false, pluginName);
        }

        if (!officialPluginNames.includes(pluginName)) {
            log.warn(`Plugin "${pluginName}" is not listed in the tag's plugins.txt`);
            return this.emptyPlan(
                `Plugin "${pluginName}" not in tag plugins.txt – refusing install`,
                false,
                pluginName
            );
        }

        const decisions = await this.planPluginUpdates({
            owner: ctx.owner,
            repo: ctx.repo,
            officialPluginNames,
            coreForCompat: ctx.coreForCompat,
            baseline: ctx.baseline,
            force,
            allowAdd: true,
            onlyName: pluginName
        });

        const plan: UpdatePlan = {
            fromTag: ctx.baseline?.tag ?? null,
            toTag: ctx.coreTarget?.name ?? ctx.baseline?.tag ?? '',
            toCommit: ctx.coreTarget?.commit ?? ctx.baseline?.commit ?? '',
            allowed: decisions.some(d => d.action === 'add' || d.action === 'update'),
            reason: `Install/update plugin ${pluginName}`,
            dirtyFiles: [],
            pluginDecisions: decisions,
            filesToOverwrite: [],
            filesToAdd: [],
            filesToKeep: [],
            dryRun,
            baselineOnly: false,
            installPlugin: pluginName
        };
        this.printPlan(plan);

        if (!plan.allowed) return plan;
        if (dryRun) return plan;

        const toApply = decisions.filter(d => d.action === 'add' || d.action === 'update');
        await this.applyPluginDecisions(ctx.owner, ctx.repo, toApply, force);
        await this.refreshBaselineAfterPlugins(ctx.baseline, toApply);
        log.info(`Plugin ${pluginName} install/update finished.`);
        return plan;
    }

    private async applyPluginDecisions(
        owner: string,
        repo: string,
        decisions: PluginDecision[],
        _force: boolean
    ): Promise<void> {
        for (const d of decisions) {
            if (!d.selectedPluginTag || !d.remotePath) continue;
            log.info(`Fetching plugin ${d.pluginId} from ${d.selectedPluginTag}…`);
            const staging = await this.stageArchive(owner, repo, d.selectedPluginTag);
            const srcRoot = path.join(staging, 'src', 'plugins', d.pluginId);
            if (!fs.existsSync(srcRoot)) {
                log.warn(`Tag ${d.selectedPluginTag} has no src/plugins/${d.pluginId} – skip`);
                continue;
            }
            const destRoot = path.join(process.cwd(), d.localPath || path.join('src', 'plugins', d.pluginId));
            fs.mkdirSync(path.dirname(destRoot), { recursive: true });
            if (fs.existsSync(destRoot)) {
                fs.rmSync(destRoot, { recursive: true, force: true });
            }
            await this.copyDir(srcRoot, destRoot);
            log.info(`Applied plugin ${d.pluginId} → ${destRoot}`);
        }
    }

    private async copyDir(src: string, dest: string): Promise<void> {
        fs.mkdirSync(dest, { recursive: true });
        for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
            const s = path.join(src, ent.name);
            const d = path.join(dest, ent.name);
            if (ent.isDirectory()) await this.copyDir(s, d);
            else if (ent.isFile()) fs.copyFileSync(s, d);
        }
    }

    private async refreshBaselineAfterPlugins(
        baseline: Baseline | null,
        applied: PluginDecision[]
    ): Promise<void> {
        const files: Record<string, BaselineFileEntry> = baseline ? { ...baseline.files } : {};
        const allLocal = walkLocal().filter(f => !shouldHardExclude(f));
        for (const d of applied) {
            const root = (d.localPath || `src/plugins/${d.pluginId}`).replace(/\\/g, '/');
            for (const k of Object.keys(files)) {
                if (k === root || k.startsWith(root + '/')) delete files[k];
            }
            const pluginFiles = allLocal.filter(f => f === root || f.startsWith(root + '/'));
            Object.assign(files, await computeLocalHashes(pluginFiles));
        }
        writeBaseline({
            tag: baseline?.tag ?? readPackageVersion()?.toString() ?? 'unknown',
            commit: baseline?.commit ?? '',
            timestamp: new Date().toISOString(),
            files
        });
    }

    private async runBaselineOnly(ctx: {
        target: TagInfo;
        stagingRoot: string;
        remoteFiles: string[];
        dryRun: boolean;
        force: boolean;
    }): Promise<UpdatePlan> {
        const { target, stagingRoot, remoteFiles, dryRun } = ctx;
        log.info(`Building baseline from nearest tag ${target.name}…`);

        const matching: Record<string, BaselineFileEntry> = {};
        const mismatched: string[] = [];

        for (const rel of remoteFiles) {
            if (shouldHardExclude(rel)) continue;
            const localFull = path.join(process.cwd(), rel);
            const remoteFull = path.join(stagingRoot, rel);
            if (!fs.existsSync(localFull) || !fs.existsSync(remoteFull)) continue;
            try {
                const localResult = await hashFile(localFull);
                const remoteResult = await hashFile(remoteFull);
                if (localResult.hash === remoteResult.hash) {
                    matching[rel] = { hash: localResult.hash, size: localResult.size };
                } else {
                    mismatched.push(rel);
                }
            } catch { /* ignore */ }
        }

        const plan: UpdatePlan = {
            fromTag: null,
            toTag: target.name,
            toCommit: target.commit,
            allowed: true,
            reason: `baseline-only against nearest tag ${target.name}`,
            dirtyFiles: mismatched.map(p => ({
                path: p,
                baselineHash: '',
                currentHash: '',
                category: isPluginPath(p) ? 'plugin' : 'core'
            })),
            pluginDecisions: [],
            filesToOverwrite: [],
            filesToAdd: [],
            filesToKeep: mismatched,
            dryRun,
            baselineOnly: true,
            installPlugin: null
        };
        this.printPlan(plan);
        if (dryRun) return plan;

        writeBaseline({
            tag: target.name,
            commit: target.commit,
            timestamp: new Date().toISOString(),
            files: matching
        });
        log.info(`Baseline-only complete for tag ${target.name}`);
        return plan;
    }

    private emptyPlan(
        reason: string,
        baselineOnly = false,
        installPlugin: string | null = null
    ): UpdatePlan {
        return {
            fromTag: null, toTag: '', toCommit: '',
            allowed: false, reason,
            dirtyFiles: [], pluginDecisions: [],
            filesToOverwrite: [], filesToAdd: [], filesToKeep: [],
            dryRun: this.config.dryRun, baselineOnly, installPlugin
        };
    }

    private printPlan(plan: UpdatePlan): void {
        log.info('── Plan ─────────────────────────────────────');
        log.info(`  Mode        : ${plan.baselineOnly ? 'baseline-only' : plan.installPlugin ? 'install-plugin' : 'update'}`);
        log.info(`  From        : ${plan.fromTag ?? '(none)'}`);
        log.info(`  To / Against: ${plan.toTag || '(n/a)'}`);
        log.info(`  Reason      : ${plan.reason}`);
        log.info(`  Core overwrite/add: ${plan.filesToOverwrite.length}/${plan.filesToAdd.length}`);
        if (plan.pluginDecisions.length) {
            log.info('  Plugins:');
            for (const d of plan.pluginDecisions) {
                log.info(`    [${d.action}] ${d.pluginId} – ${d.reason}${d.selectedPluginTag ? ` @ ${d.selectedPluginTag}` : ''}`);
            }
        }
        log.info('────────────────────────────────────────────');
    }

    private async stageArchive(owner: string, repo: string, ref: string): Promise<string> {
        const dest = path.join(STAGING_DIR, ref.replace(/[^\w.-]/g, '_'));
        if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
        fs.mkdirSync(dest, { recursive: true });

        log.info(`Downloading ${ref}…`);
        const buf = await this.gh.downloadArchive(owner, repo, ref);
        const archivePath = path.join(STAGING_DIR, `${ref}.tar.gz`);
        fs.writeFileSync(archivePath, buf);

        try {
            await execFileAsync('tar', ['-xzf', archivePath, '-C', dest, '--strip-components=1'], { timeout: 60_000 });
        } catch {
            await execFileAsync('tar', ['-xzf', archivePath, '-C', dest], { timeout: 60_000 });
            const entries = fs.readdirSync(dest);
            if (entries.length === 1) {
                const inner = path.join(dest, entries[0]);
                if (fs.statSync(inner).isDirectory()) {
                    for (const name of fs.readdirSync(inner)) {
                        fs.renameSync(path.join(inner, name), path.join(dest, name));
                    }
                    fs.rmSync(inner, { recursive: true, force: true });
                }
            }
        } finally {
            try { fs.unlinkSync(archivePath); } catch { /* ignore */ }
        }
        return dest;
    }

    private collectRemoteFiles(stagingRoot: string): string[] {
        const files: string[] = [];
        function recurse(dir: string, rel: string) {
            for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
                if (ent.name === '.git' || ent.name === 'node_modules') continue;
                const r = rel ? `${rel}/${ent.name}` : ent.name;
                const full = path.join(dir, ent.name);
                if (ent.isDirectory()) recurse(full, r);
                else if (ent.isFile()) files.push(r.replace(/\\/g, '/'));
            }
        }
        recurse(stagingRoot, '');
        return files;
    }

    private async createBackup(tag: string): Promise<void> {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const dir = path.join(BACKUP_DIR, `${ts}_${tag}`);
        fs.mkdirSync(dir, { recursive: true });
        for (const c of ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'tsconfig.json', 'index.js', 'index.d.ts']) {
            const src = path.join(process.cwd(), c);
            if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, c));
        }
        const coreSrc = path.join(process.cwd(), 'core');
        if (fs.existsSync(coreSrc)) {
            await execFileAsync('cp', ['-a', coreSrc, path.join(dir, 'core')]).catch(() => {});
        }
        log.info(`Backup → ${dir}`);
    }

    private async applyCoreFromStaging(stagingRoot: string, plan: UpdatePlan): Promise<void> {
        const all = [...plan.filesToOverwrite, ...plan.filesToAdd];
        for (const rel of all) {
            if (isPluginPath(rel)) continue;
            const src = path.join(stagingRoot, rel);
            const dest = path.join(process.cwd(), rel);
            if (!fs.existsSync(src)) continue;
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(src, dest);
        }
        log.info(`Applied ${all.length} core file(s)`);
    }

    private async rebuild(): Promise<void> {
        log.info('Rebuild sequence…');
        try {
            await execFileAsync('npm', ['run', 'clean'], { cwd: process.cwd(), timeout: 60_000 });
        } catch { /* ignore */ }
        try {
            await execFileAsync('npm', ['run', 'clean'], { cwd: process.cwd(), timeout: 60_000 });
        } catch { /* ignore */ }
        await execFileAsync('npm', ['run', 'build'], {
            cwd: process.cwd(),
            timeout: this.config.timeoutMs
        });
        log.info('Rebuild finished');
    }

    private pruneBackups(): void {
        try {
            const entries = fs.readdirSync(BACKUP_DIR)
                .map(name => ({
                    name,
                    full: path.join(BACKUP_DIR, name),
                    mtime: fs.statSync(path.join(BACKUP_DIR, name)).mtimeMs
                }))
                .sort((a, b) => b.mtime - a.mtime);
            for (const e of entries.slice(this.config.maxBackups)) {
                fs.rmSync(e.full, { recursive: true, force: true });
            }
        } catch { /* ignore */ }
    }
}

export async function runUpdater(options: {
    force?: boolean;
    dryRun?: boolean;
    baselineOnly?: boolean;
    installPlugin?: string | null;
} = {}): Promise<void> {
    const updater = new Updater();
    const plan = await updater.run(options);

    if (!plan.allowed && plan.dirtyFiles.length > 0) process.exitCode = 2;
    else if (!plan.allowed) process.exitCode = plan.installPlugin ? 1 : 0;
    else process.exitCode = 0;
}
