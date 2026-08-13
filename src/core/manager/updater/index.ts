import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getLogger } from '#core/utils/logger.js';
import { secrets } from '#core/helpers/secretManager.js';
import { SemVer } from '#core/utils/semver.js';
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
        } catch {
        }
    }
    return out;
}

function decidePlugins(
    localFiles: string[],
    remoteFiles: Set<string>,
    manifestName: string
): PluginDecision[] {
    const decisions: PluginDecision[] = [];
    const localRoots = new Set<string>();
    const remoteRoots = new Set<string>();

    for (const f of localFiles) {
        const r = pluginRoot(f);
        if (r) localRoots.add(r);
    }
    for (const f of remoteFiles) {
        const r = pluginRoot(f);
        if (r) remoteRoots.add(r);
    }

    for (const root of new Set([...localRoots, ...remoteRoots])) {
        const localManifest = path.join(process.cwd(), root, manifestName);
        const hasLocal = fs.existsSync(localManifest);
        const remoteHas = [...remoteFiles].some(f => f === root || f.startsWith(root + '/'));

        let localId: string | undefined;
        if (hasLocal) {
            try {
                const j = JSON.parse(fs.readFileSync(localManifest, 'utf-8'));
                localId = j.id || j.name;
            } catch {  }
        }

        if (!remoteHas) {
            decisions.push({
                pluginId: root, localPath: root, remotePath: null,
                action: 'leave', reason: 'Exists only locally – never touched',
                localManifestId: localId
            });
            continue;
        }

        if (!localRoots.has(root)) {
            decisions.push({
                pluginId: root, localPath: root, remotePath: root,
                action: 'add', reason: 'Present on remote, absent locally'
            });
            continue;
        }

        if (hasLocal && localId) {
            decisions.push({
                pluginId: root, localPath: root, remotePath: root,
                action: 'update', reason: `Local id="${localId}" – will verify after download`,
                localManifestId: localId
            });
        } else if (!hasLocal) {
            decisions.push({
                pluginId: root, localPath: root, remotePath: root,
                action: 'update', reason: 'No local manifest – legacy plugin, will update'
            });
        } else {
            decisions.push({
                pluginId: root, localPath: root, remotePath: root,
                action: 'leave', reason: 'Local manifest missing id – safer to leave'
            });
        }
    }
    return decisions;
}

function refinePluginDecisions(
    decisions: PluginDecision[],
    stagingRoot: string,
    manifestName: string
): PluginDecision[] {
    return decisions.map(d => {
        if (d.action !== 'update' || !d.remotePath) return d;
        const remoteMan = path.join(stagingRoot, d.remotePath, manifestName);
        if (!fs.existsSync(remoteMan)) return d;

        try {
            const j = JSON.parse(fs.readFileSync(remoteMan, 'utf-8'));
            const remoteId = j.id || j.name;
            if (d.localManifestId && remoteId && d.localManifestId !== remoteId) {
                return {
                    ...d,
                    action: 'leave' as const,
                    reason: `id mismatch (local="${d.localManifestId}" vs remote="${remoteId}")`,
                    remoteManifestId: remoteId
                };
            }
            return { ...d, remoteManifestId: remoteId, reason: `id matches (${remoteId})` };
        } catch {
            return d;
        }
    });
}

function readPackageVersion(): SemVer | null {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'));
        return SemVer.parse(pkg.version);
    } catch {
        return null;
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
    } = {}): Promise<UpdatePlan> {
        ensureDirs();
        const force        = options.force ?? false;
        const dryRun       = options.dryRun ?? this.config.dryRun;
        const baselineOnly = options.baselineOnly ?? false;

        log.info(`Updater start (baselineOnly=${baselineOnly}, dryRun=${dryRun}, force=${force})`);

        let owner: string, repo: string;
        const input = this.config.repositoryUrl || this.config.defaultRepo;

        if (this.config.repositoryUrl) {
            try {
                ({ owner, repo } = GitHubClient.parseRepo(this.config.repositoryUrl));
            } catch (e) {
                log.warn(`RepositoryUrl invalid – aborting: ${(e as Error).message}`);
                return this.emptyPlan('Invalid RepositoryUrl', baselineOnly);
            }
        } else {
            ({ owner, repo } = GitHubClient.parseRepo(this.config.defaultRepo));
        }
        log.info(`Repository: ${owner}/${repo}`);

        const baseline = readBaseline();
        let currentSemVer: SemVer | null = null;
        if (baseline) {
            try { currentSemVer = SemVer.parse(baseline.tag); } catch {  }
        }
        if (!currentSemVer) currentSemVer = readPackageVersion();

        let target: TagInfo | null;

        try {
            if (baselineOnly) {
                target = await this.gh.findNearestTag(owner, repo, currentSemVer);
                if (target) log.info(`baseline-only: selected nearest tag ${target.name}`);
            } else {
                target = await this.gh.getLatestAllowedTag(owner, repo, currentSemVer, this.config.devBuilds);
            }
        } catch (e) {
            if (this.config.repositoryUrl) {
                log.warn(`RepositoryUrl unreachable – aborting: ${(e as Error).message}`);
                return this.emptyPlan(`RepositoryUrl unreachable: ${(e as Error).message}`, baselineOnly);
            }
            throw e;
        }

        if (!target || !target.semver) {
            log.info('No suitable tag found.');
            return this.emptyPlan('No suitable tag', baselineOnly);
        }

        const stagingRoot = await this.stageArchive(owner, repo, target.name);
        const remoteFiles = this.collectRemoteFiles(stagingRoot);
        const remoteSet   = new Set(remoteFiles);
        const localFiles  = walkLocal().filter(f => !shouldHardExclude(f));

        let pluginDecisions = decidePlugins(localFiles, remoteSet, this.config.pluginManifest);
        pluginDecisions = refinePluginDecisions(pluginDecisions, stagingRoot, this.config.pluginManifest);
        const leavePlugins = new Set(
            pluginDecisions.filter(d => d.action === 'leave').map(d => d.localPath)
        );

        if (baselineOnly) {
            return this.runBaselineOnly({
                target, stagingRoot, remoteFiles, localFiles,
                leavePlugins, dryRun, force
            });
        }

        const dirtyFiles: DirtyFile[] = [];
        if (this.config.safeUpdate && baseline && !force) {
            for (const [rel, entry] of Object.entries(baseline.files)) {
                if (leavePlugins.has(pluginRoot(rel) || '')) continue;
                if (shouldHardExclude(rel)) continue;
                const full = path.join(process.cwd(), rel);
                if (!fs.existsSync(full)) continue;

                try {
                    const current = await hashFile(full);
                    if (current.hash !== entry.hash) {
                        dirtyFiles.push({
                            path: rel,
                            baselineHash: entry.hash,
                            currentHash: current.hash,
                            category: isPluginPath(rel) ? 'plugin' : 'core'
                        });
                    }
                } catch { }
            }
        }

        if (dirtyFiles.length > 0 && this.config.safeUpdate && !force) {
            log.warn(`SafeUpdate blocked – ${dirtyFiles.length} modified file(s):`);
            for (const d of dirtyFiles.slice(0, 15)) log.warn(`  • ${d.path}`);
            if (dirtyFiles.length > 15) log.warn(`  … +${dirtyFiles.length - 15} more`);
            return {
                fromTag: baseline?.tag ?? null,
                toTag: target.name,
                toCommit: target.commit,
                allowed: false,
                reason: `SafeUpdate blocked: ${dirtyFiles.length} user-modified file(s)`,
                dirtyFiles,
                pluginDecisions,
                filesToOverwrite: [],
                filesToAdd: [],
                filesToKeep: [],
                dryRun,
                baselineOnly: false
            };
        }

        const filesToOverwrite: string[] = [];
        const filesToAdd: string[] = [];
        const filesToKeep: string[] = [];

        for (const rel of localFiles) {
            const p = pluginRoot(rel);
            if (p && leavePlugins.has(p)) { filesToKeep.push(rel); continue; }
            if (remoteSet.has(rel)) filesToOverwrite.push(rel);
            else if (this.config.keepExtra) filesToKeep.push(rel);
        }
        for (const rel of remoteFiles) {
            if (!localFiles.includes(rel)) {
                const p = pluginRoot(rel);
                if (p && leavePlugins.has(p)) continue;
                filesToAdd.push(rel);
            }
        }

        const plan: UpdatePlan = {
            fromTag: baseline?.tag ?? null,
            toTag: target.name,
            toCommit: target.commit,
            allowed: true,
            reason: `Update to ${target.name}`,
            dirtyFiles,
            pluginDecisions,
            filesToOverwrite,
            filesToAdd,
            filesToKeep,
            dryRun,
            baselineOnly: false
        };
        this.printPlan(plan);

        if (dryRun) {
            log.info('Dry-run – no changes written.');
            return plan;
        }

        await this.createBackup(baseline?.tag ?? 'unknown');
        await this.applyFromStaging(stagingRoot, plan, leavePlugins);
        await this.rebuild();

        const managed = [...filesToOverwrite, ...filesToAdd].filter(f => {
            const p = pluginRoot(f);
            return !p || !leavePlugins.has(p);
        });
        writeBaseline({
            tag: target.name,
            commit: target.commit,
            timestamp: new Date().toISOString(),
            files: await computeLocalHashes(managed)
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
        log.info(`Update to ${target.name} completed.`);
        return plan;
    }

    private async runBaselineOnly(ctx: {
        target: TagInfo;
        stagingRoot: string;
        remoteFiles: string[];
        localFiles: string[];
        leavePlugins: Set<string>;
        dryRun: boolean;
        force: boolean;
    }): Promise<UpdatePlan> {
        const { target, stagingRoot, remoteFiles, localFiles, leavePlugins, dryRun } = ctx;

        log.info(`Building baseline from nearest tag ${target.name}…`);

        const matching: Record<string, BaselineFileEntry> = {};
        const mismatched: string[] = [];

        for (const rel of remoteFiles) {
            const p = pluginRoot(rel);
            if (p && leavePlugins.has(p)) continue;
            if (shouldHardExclude(rel)) continue;

            const localFull  = path.join(process.cwd(), rel);
            const remoteFull = path.join(stagingRoot, rel);

            if (!fs.existsSync(localFull) || !fs.existsSync(remoteFull)) continue;

            try {
                const localResult  = await hashFile(localFull);
                const remoteResult = await hashFile(remoteFull);

                if (localResult.hash === remoteResult.hash) {
                    matching[rel] = { hash: localResult.hash, size: localResult.size };
                } else {
                    mismatched.push(rel);
                }
            } catch {  }
        }

        log.info(`Matched ${Object.keys(matching).length} file(s) to tag ${target.name}`);
        if (mismatched.length) {
            log.info(`${mismatched.length} file(s) differ from that tag – treated as user-updated (excluded from baseline):`);
            for (const m of mismatched.slice(0, 20)) log.info(`  • ${m}`);
            if (mismatched.length > 20) log.info(`  … +${mismatched.length - 20} more`);
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
            baselineOnly: true
        };
        this.printPlan(plan);

        if (dryRun) {
            log.info('Dry-run – baseline not written.');
            return plan;
        }

        writeBaseline({
            tag: target.name,
            commit: target.commit,
            timestamp: new Date().toISOString(),
            files: matching
        });

        log.info(`Baseline-only complete for tag ${target.name}`);
        return plan;
    }

    private emptyPlan(reason: string, baselineOnly = false): UpdatePlan {
        return {
            fromTag: null, toTag: '', toCommit: '',
            allowed: false, reason,
            dirtyFiles: [], pluginDecisions: [],
            filesToOverwrite: [], filesToAdd: [], filesToKeep: [],
            dryRun: this.config.dryRun, baselineOnly
        };
    }

    private printPlan(plan: UpdatePlan): void {
        log.info('── Plan ─────────────────────────────────────');
        log.info(`  Mode        : ${plan.baselineOnly ? 'baseline-only' : 'update'}`);
        log.info(`  From        : ${plan.fromTag ?? '(none)'}`);
        log.info(`  To / Against: ${plan.toTag}`);
        log.info(`  Reason      : ${plan.reason}`);
        if (!plan.baselineOnly) {
            log.info(`  Overwrite   : ${plan.filesToOverwrite.length}`);
            log.info(`  Add         : ${plan.filesToAdd.length}`);
            log.info(`  Keep        : ${plan.filesToKeep.length}`);
        } else {
            log.info(`  Matched     : (see log above)`);
            log.info(`  User-updated: ${plan.filesToKeep.length}`);
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
            try { fs.unlinkSync(archivePath); } catch {  }
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
        const ts  = new Date().toISOString().replace(/[:.]/g, '-');
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

    private async applyFromStaging(
        stagingRoot: string,
        plan: UpdatePlan,
        leavePlugins: Set<string>
    ): Promise<void> {
        const all = [...plan.filesToOverwrite, ...plan.filesToAdd];
        for (const rel of all) {
            const p = pluginRoot(rel);
            if (p && leavePlugins.has(p)) continue;
            const src  = path.join(stagingRoot, rel);
            const dest = path.join(process.cwd(), rel);
            if (!fs.existsSync(src)) continue;
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(src, dest);
        }
        log.info(`Applied ${all.length} file(s)`);
    }

    private async rebuild(): Promise<void> {
        log.info('Rebuild sequence…');
        try {
            await execFileAsync('npm', ['run', 'clean'], { cwd: process.cwd(), timeout: 60_000 });
        } catch {  }

        try {
            await execFileAsync('npm', ['run', 'clean'], { cwd: process.cwd(), timeout: 60_000 });
        } catch {  }

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
        } catch {  }
    }
}

export async function runUpdater(options: {
    force?: boolean;
    dryRun?: boolean;
    baselineOnly?: boolean;
} = {}): Promise<void> {
    const updater = new Updater();
    const plan = await updater.run(options);

    if (!plan.allowed && plan.dirtyFiles.length > 0) process.exitCode = 2;
    else process.exitCode = 0;
}