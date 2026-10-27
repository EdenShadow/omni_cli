export const DEFAULT_BOT_PROVIDER_ORDER = Object.freeze(['codex', 'claude', 'dsh', 'wanwu']);

export function normalizeBotProviderOrder(value) {
  const known = DEFAULT_BOT_PROVIDER_ORDER;
  return [...new Set([...(Array.isArray(value) ? value.filter(p => known.includes(p)) : []), ...known])];
}
