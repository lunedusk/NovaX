export type DashUiTier = 1 | 2 | 3;

export type DashSurfaceKind =
    | 'page'
    | 'subpage'
    | 'home_widget'
    | 'tab'
    | 'settings_section'
    | 'server_page'
    | 'modal'
    | 'drawer'
    | 'row_action'
    | 'header_badge'
    | 'command_palette'
    | 'toast'
    | 'onboarding_step';

export const DASH_SURFACE_KINDS: readonly DashSurfaceKind[] = [
    'page',
    'subpage',
    'home_widget',
    'tab',
    'settings_section',
    'server_page',
    'modal',
    'drawer',
    'row_action',
    'header_badge',
    'command_palette',
    'toast',
    'onboarding_step',
] as const;

export type BitsMode = 'all' | 'any';

export interface DashVisibilityRule {
    requiredBits?: string[];
    bitsMode?: BitsMode;
    envOwnerOnly?: boolean;
    allowRoleBotOwner?: boolean;
    allowUserIds?: string[];
    denyUserIds?: string[];
    guildIds?: string[];
    denyGuildIds?: string[];
    featureFlag?: string;
    defaultHidden?: boolean;
    readBits?: string[];
    writeBits?: string[];
    memberVisibility?: 'self' | 'moderators' | 'admins' | 'owner' | 'all_permitted';
}

export interface DashThemePrefs {
    inheritTokens?: boolean;
    accent?: string;
    font?: string;
    icon?: string;
    colorScheme?: 'inherit' | 'light' | 'dark';
    customCssPath?: string;
}

export type DashDeclarativePayload =
    | { type: 'config_form'; pluginId?: string; configStem?: string }
    | { type: 'lang_editor'; pluginId?: string; locale?: string }
    | { type: 'stats_cards'; metrics: string[] }
    | { type: 'table'; source: string; columns: Array<{ key: string; label: string }> }
    | { type: 'markdown'; contentKey: string }
    | { type: 'link_out'; url: string; external: true };

export interface DashSurfaceBase {
    id: string;
    kind: DashSurfaceKind;
    tier: DashUiTier;
    title: string;
    description?: string;
    icon?: string;
    order?: number;
    priority?: number;
    visibility?: DashVisibilityRule;
    theme?: DashThemePrefs;
    dashCompat?: string;
    dependencies?: string[];
    settingsSchemaId?: string;
    settingsSchema?: Record<string, unknown>;
    declarative?: DashDeclarativePayload;
    iframe?: {
        entryHtml: string;
        originKey?: string;
    };
    hostModule?: {
        exportName?: string;
        moduleKey: string;
    };
    nav?: {
        sidebar?: boolean;
        group?: string;
        parentSurfaceId?: string;
    };
    inject?: {
        targetPageId?: string;
        targetTableId?: string;
        slot?: string;
    };
}

export interface PluginDashboardManifest {
    schemaVersion: 1;
    pluginId: string;
    label?: string;
    surfaces: DashSurfaceBase[];
    themePresets?: Array<{ id: string; name: string; tokens: Record<string, string> }>;
    dashCompat: string;
}

export type PluginSignedStatus = 'signed' | 'unsigned' | 'failed' | 'bypassed' | 'unknown';

export interface DashSurfaceResolved extends DashSurfaceBase {
    pluginId: string;
    visibleEstimate: boolean;
    blockedReason?: string;
    assetOrigin?: string | null;
    assetEntryUrl?: string | null;
}

export interface DashRegistryPluginEntry {
    pluginId: string;
    signed: PluginSignedStatus;
    unsignedBadge: boolean;
    state: string;
    manifest: PluginDashboardManifest | null;
    surfaces: DashSurfaceResolved[];
}

export interface DashRegistrySnapshot {
    version: number;
    generatedAt: number;
    assetOrigin: string;
    plugins: DashRegistryPluginEntry[];
}
