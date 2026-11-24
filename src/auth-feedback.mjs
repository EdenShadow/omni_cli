export function formatCliError(error) {
  if(error.signInRejected||['AUTH_BLOCKED','AUTH_INVALID_CREDENTIALS','AUTH_RATE_LIMITED'].includes(error.code)){
    return '登录失败，请稍后重试。 / Sign-in failed. Please try again later.';
  }
  return '错误 / Error: '+error.message;
}
