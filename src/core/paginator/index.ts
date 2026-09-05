export { PAGINATOR_LIMITS } from './limits/discord.js';
export { measureContentChars, measureCv2TextFromStrings, isUnderBudget } from './limits/measure.js';
export type { AtomicUnit, PageMeta, PagePayload, RenderMode, NavAction } from './types/models.js';
export type { PaginatorCreateOptions, SplitPolicy, SessionPolicy, NavPolicy } from './types/options.js';
export { packAtomicUnits, defaultPackOptions } from './split/atomic.js';
export { newSessionId, encodeNavCustomId, parseNavCustomId } from './controls/ids.js';
export { canAttachNav, paginationButtonBudget } from './controls/capacity.js';
export {
    buildNavButtons,
    buildNavRow,
    buttonBuilderToCv2Spec,
    buttonBuildersToCv2ActionRows,
    navHasPageIndicator,
} from './controls/buttons.js';
export type { Cv2NavButtonSpec, Cv2NavButtonStyle } from './controls/buttons.js';
export {
    putSession,
    getSession,
    deleteSession,
    clearUserSessions,
    touchSession,
} from './session/store.js';
export { Paginator, unitsFromLines, canPaginateWithNav, maxPaginationButtons } from './runtime/Paginator.js';
export { replyOrPaginate } from './runtime/auto.js';
export type { AutoPaginateOptions, AutoPaginateResult } from './runtime/auto.js';
export { buildSessionMessagePayload } from './runtime/payload.js';
