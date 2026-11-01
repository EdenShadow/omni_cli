import {redactSecretValues} from './conversation-privacy.mjs';

export const ENCRYPTED_COMMAND_ERROR = '任务执行失败，详细原因暂不可用，请在执行设备查看 / Task failed; details unavailable';
const LEGACY_COMMAND_ERROR = '加密群聊任务未完成，请在原电脑检查 / Encrypted chat task failed; check the source device';

export const commandErrorContext = command => ['command-error', command.sessionId, command.id];

// Error details use the same project keys as the transcript. A missing/bad
// envelope must not make the rest of the conversation unreadable.
export async function decryptCommandError(command, decrypt) {
  if (!command?.id || !command.sessionId || !command.projectId) return command;
  const fallback = command.error === LEGACY_COMMAND_ERROR ? ENCRYPTED_COMMAND_ERROR : command.error;
  if (command.secureError) {
    try {
      const clear = await decrypt(command.projectId, commandErrorContext(command), command.secureError);
      if (typeof clear?.error === 'string' && clear.error.trim()) {
        return {...command, error: redactSecretValues(clear.error).slice(0, 2000)};
      }
    } catch { /* Keep a terminal, readable failure even while keys are unavailable. */ }
    return {...command, error: fallback || ENCRYPTED_COMMAND_ERROR};
  }
  return fallback === command.error ? command : {...command, error: fallback};
}
