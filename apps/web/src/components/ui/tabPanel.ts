/** The id of one tab. The panel names itself with the id of the open tab. */
export function tabId(idPrefix: string, tab: string): string {
  return `${idPrefix}-tab-${tab}`;
}

/** The id of the box that holds the open tab's content */
export function tabPanelId(idPrefix: string): string {
  return `${idPrefix}-panel`;
}

/** The props of the box that holds the open tab's content */
export function tabPanelProps(idPrefix: string, openTab: string) {
  return { role: 'tabpanel', id: tabPanelId(idPrefix), 'aria-labelledby': tabId(idPrefix, openTab) } as const;
}
