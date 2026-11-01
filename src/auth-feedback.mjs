export function formatCliError(error) {
  if(error.code==='AUTH_BLOCKED') return [
    '', '  万物 Omni · 登录已锁定 / Sign-in locked',
    '  ──────────────────────────────────────',
    '  错误次数已达上限，请联系管理员解封。',
    '  Too many incorrect attempts. Contact the administrator.',
    '', '  联系 / Email    edenworm@gmail.com',
    ...(error.reference?['  编号 / Case     '+error.reference]:[]),
    '  ──────────────────────────────────────', '',
  ].join('\n');
  if(error.code==='AUTH_INVALID_CREDENTIALS')return `\n  账号或密码不正确 / Incorrect username or password.\n  已输错 / Attempts: ${error.failures ?? '?'} / 10\n  达到 10 次将锁定账号与 IP，请检查后再试。\n  Account and IP lock at 10 incorrect attempts.\n`;
  if(error.code==='AUTH_RATE_LIMITED')return '\n  尝试过于频繁，请一分钟后再试。\n  Too many attempts. Please try again in a minute.\n';
  return '错误 / Error: '+error.message;
}
