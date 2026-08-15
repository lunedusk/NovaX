export interface BaselineFileEntry {
    hash: string;
    size: number;
}

export interface Baseline {
    tag: string;
    commit: string;
    timestamp: string;
    previousTag?: string | null;
    previousCommit?: string | null;
    files: Record<string, BaselineFileEntry>;
}

export type PluginLineKind = 'in-repo' | 'external';
export interface PluginSourceLine {
    id: string;
    kind: PluginLineKind;
    repo: string | null;
    pinnedTag: string | null;
    raw: string;
}

export type PluginLayout = 'L1' | 'L2' | 'L3';

export interface PluginDecision {
    pluginId: string;
    localPath: string;
    runtimePath: string;
    remotePath: string | null;
    action: 'update' | 'leave' | 'add' | 'skip';
    reason: string;
    localManifestId?: string;
    remoteManifestId?: string;
    selectedPluginTag?: string;
    layout?: PluginLayout;
    source?: PluginSourceLine;
}

export interface DirtyFile {
    path: string;
    baselineHash: string;
    currentHash: string;
    category: 'core' | 'plugin';
}

export interface UpdatePlan {
    fromTag: string | null;
    toTag: string;
    toCommit: string;
    allowed: boolean;
    reason: string;
    dirtyFiles: DirtyFile[];
    pluginDecisions: PluginDecision[];
    filesToOverwrite: string[];
    filesToAdd: string[];
    filesToKeep: string[];
    dryRun: boolean;
    baselineOnly: boolean;
    installPlugin: string | null;
    targetTag?: string | null;
    downgrade?: boolean;
}

export interface UpdaterConfig {
    autoUpdater: boolean;
    repositoryUrl: string | null;
    githubPat: string | null;
    defaultRepo: string;
    branch: string;
    devBuilds: boolean;
    safeUpdate: boolean;
    keepExtra: boolean;
    allowForce: boolean;
    dryRun: boolean;
    maxBackups: number;
    timeoutMs: number;
    postUpdateCmd: string | null;
    notifyChannel: string | null;
    pluginManifest: string;
    mode: 'standalone' | 'background';
    pluginPublicKeys: Record<string, string>;
    publicKey: string | null;
    intervalMs: number;
    backgroundApply: boolean;
    autoRollback: boolean;
    healthGraceMs: number;
}
export interface PendingHealth {
    toTag: string;
    previousTag: string | null;
    previousCommit?: string | null;
    at: string;
    healthy?: boolean;
    bootAttempts?: number;
}

export interface TagInfo {
    name: string;
    commit: string;
    semver: import('#core/utils/semver.js').SemVer | null;
}

export interface TakebackEntry {
    tag: string;
    status: 'superseded' | 'withdrawn';
    recommend?: string | null;
    reason?: string;
    severity?: string;
    at?: string | null;
    active?: boolean;
}

export interface TakebacksFile {
    schemaVersion: number;
    entries: TakebackEntry[];
}
