import type { SidebarBrandMarkOwnerProps, SidebarRootComponentProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { BrandLogo } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Render the official mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the designer-supplied HiBuddy mark.
 */
export function OfficialBrandMark(props: SidebarBrandMarkOwnerProps) {
  return <BrandLogo {...props} />
}

/**
 * Render the localized product name beside the independently slotted mark.
 * @param props - Sidebar translation function.
 * @returns The localized HiBuddy name.
 */
export function OfficialBrandName({ t }: Pick<SidebarRootComponentProps, 't'>) {
  return <>{t('brand.name')}</>
}
