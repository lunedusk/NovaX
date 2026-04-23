import { LayoutSpec, BuildContext, BuildOptions, BuildResult } from "./types.js";
import { runBuild } from "./core.js";
import { AssetManager } from "../helpers/assets.js";

export class ComponentV2Engine {
    private globalContext: BuildContext;
    private defaultOptions: BuildOptions;

    constructor(globalContext: BuildContext = {}, defaultOptions: BuildOptions = {}) {
        this.globalContext = globalContext;
        this.defaultOptions = defaultOptions;
    }

    public configure(context?: BuildContext, options?: BuildOptions) {
        if (context) {
            this.globalContext = {
                attachments: { ...this.globalContext.attachments, ...context.attachments },
                variables: { ...this.globalContext.variables, ...context.variables },
                disableAll: context.disableAll ?? this.globalContext.disableAll
            };
        }
        if (options) this.defaultOptions = { ...this.defaultOptions, ...options };
    }

    public build(spec: LayoutSpec, localContext: BuildContext = {}, localOptions: BuildOptions = {}): BuildResult {
        const mergedContext: BuildContext = {
            assetManager: localContext.assetManager || this.globalContext.assetManager || new AssetManager(),
            attachments: { ...this.globalContext.attachments, ...localContext.attachments },
            variables: { ...this.globalContext.variables, ...localContext.variables },
            disableAll: localContext.disableAll ?? this.globalContext.disableAll ?? false
        };
        const mergedOptions: BuildOptions = { ...this.defaultOptions, ...localOptions };
        return runBuild(spec, mergedContext, mergedOptions);
    }
}

export const ComponentEngine = new ComponentV2Engine({}, { autoWrapInteractives: true });

export function buildComponentsV2(spec: LayoutSpec, context: BuildContext = {}, options: BuildOptions = {}): BuildResult {
    return new ComponentV2Engine().build(spec, context, options);
}

export function buildComponentsV2Strict(spec: LayoutSpec, context: BuildContext = {}): BuildResult {
    return new ComponentV2Engine().build(spec, context, { autoWrapInteractives: false });
}

export function buildComponentsV2AutoWrap(spec: LayoutSpec, context: BuildContext = {}): BuildResult {
    return new ComponentV2Engine().build(spec, context, { autoWrapInteractives: true });
}