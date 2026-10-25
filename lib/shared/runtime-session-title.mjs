// Older Harness projections flattened and truncated the execution prompt, which
// includes a host-only scope suffix. Strip that suffix even when truncated.
export function runtimeSessionTitle(title) {
  if (typeof title !== 'string') return title;
  return title.replace(/\s*<wanwu\s+scope="[0-9a-f]{8}-[\s\S]*$/i, '').trim();
}
