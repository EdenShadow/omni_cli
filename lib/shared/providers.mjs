// One ordered catalog for device binding, session creation and skill sync.
export const PROVIDERS = Object.freeze([ 'codex', 'claude', 'dsh']);
export const PROVIDER_NAMES = Object.freeze({wanwu:'万物 AI',codex:'Codex',claude:'Claude Code',dsh:'DeepSeek Harness'});
export const providerName = (provider, english = false) => provider === 'wanwu' && english ? 'Omni AI' : PROVIDER_NAMES[provider] || provider;
