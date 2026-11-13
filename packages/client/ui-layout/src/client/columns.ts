/** Column geometry; narrow frames show the right panel as an overlay. */
export interface Columns { sidebar: number; center: number; rightbar: number }

/** Expanded navigation width in CSS pixels. */
export const SIDEBAR_DEFAULT = 236
/** Sidebar drag range; the expanded default keeps the current navigation geometry. */
export const SIDEBAR_MIN = 220
export const SIDEBAR_MAX = 420

/** Clamp a panel preference using the upstream frame's whole-pixel geometry. */
export function clampWidth(width: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(width)))
}

/** Keep the upstream 400px main-column allowance where the frame has room. */
export function sidebarBounds(viewport: number): RightbarBounds {
  return { min: SIDEBAR_MIN, max: Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_DEFAULT, viewport - 400)) }
}
/** Initial right panel width in CSS pixels, including overlay presentation. */
export const RIGHTBAR_WIDTH = 336
/** Largest viewport width that overlays the right panel instead of reserving a column. */
export const RIGHTBAR_OVERLAY_BREAKPOINT = 1180

/** Allowed right-panel widths for the current frame. */
export interface RightbarBounds { readonly min: number; readonly max: number }

/**
 * Keep 360px for wide-screen main content, or a 24px edge beside an overlay.
 * @param viewport - frame width in pixels.
 * @param sidebar - currently reserved navigation width in pixels.
 * @returns the minimum and maximum panel widths that fit the frame.
 */
export function rightbarBounds(viewport: number, sidebar: number): RightbarBounds {
  const max = Math.max(0, Math.floor(viewport > RIGHTBAR_OVERLAY_BREAKPOINT
    ? viewport - sidebar - 360
    : viewport - 24))
  return { min: Math.min(280, max), max }
}

/**
 * Fit a preferred panel width to the current frame without losing the preference.
 * @param width - preferred panel width in pixels.
 * @param bounds - limits for the current frame.
 * @returns the nearest allowed whole-pixel width.
 */
export function clampRightbarWidth(width: number, bounds: RightbarBounds): number {
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(width)))
}

/**
 * Resolve reserved column widths. An overlay retains its full panel width
 * while reserving zero space beside the main column.
 * @param viewport - frame width in px.
 * @param rightbarTrack - whether the right panel requests space.
 * @param panelWidth - resolved normal width of the right panel.
 * @param sidebar - resolved sidebar track width, including its collapsed state.
 * @returns reserved widths for the three columns.
 */
export function computeColumns(
  viewport: number, rightbarTrack: boolean, panelWidth = RIGHTBAR_WIDTH, sidebar = SIDEBAR_DEFAULT,
): Columns {
  const rightbar = rightbarTrack && viewport > RIGHTBAR_OVERLAY_BREAKPOINT ? panelWidth : 0
  return { sidebar, center: Math.max(0, viewport - sidebar - rightbar), rightbar }
}
