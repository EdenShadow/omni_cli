import {PROVIDERS} from '../shared/providers.mjs';
import {randomUUID} from 'node:crypto';
import {validateRuntimeAnswer} from '../shared/runtime-questions.mjs';

const providers = PROVIDERS;

// Local to this computer/account. Never changes the Runtime's global config.
// New computers default to full access; an explicitly saved false stays in ask mode.
export function applyRuntimeAccess(adapter, getApprovals, provider) {
  const create = adapter.create.bind(adapter), run = adapter.run.bind(adapter);
  adapter.create = (cwd, options) => create(cwd, getApprovals().executionOptions(provider, options));
  adapter.run = (id, prompt, emit, options) => run(id, prompt, emit, getApprovals().executionOptions(provider, options));
  return adapter;
}
export class RuntimeApprovals {
  constructor({store, save, notify, timeoutMs = 300000}) {
    Object.assign(this, {store, save, notify, timeoutMs});
    this.pending = new Map();
    this.closed = false;
  }
  account() {
    return this.store.userId ? JSON.stringify([this.store.endpoint || '', this.store.userId]) : null;
  }
  settings(update, exceptId) {
    const account = this.account();
    if (update?.provider !== undefined) {
      if (!account || !providers.includes(update.provider) || typeof update.alwaysAllow !== 'boolean')
        throw Error('无效的创作授权设置');
      const previous = this.store.creationPermissions;
      this.store.creationPermissions = {...previous,
        [account]: {...previous?.[account], [update.provider]: update.alwaysAllow}};
      try { this.save(); } catch (error) {
        this.store.creationPermissions = previous;
        throw error;
      }
      if (update.alwaysAllow) this.allowPending(account, update.provider, exceptId);
    }
    return Object.fromEntries(providers.map(provider => [provider,
      !!account && this.store.creationPermissions?.[account]?.[provider] !== false]));
  }
  executionOptions(provider, options = {}) {
    // A computer's ask setting caps every task, including IM and remote sends.
    // A task can still explicitly request narrower workspace access.
    return {...options, access: this.settings()[provider] && options.access !== 'workspace' ? 'full' : 'workspace'};
  }
  canRemember(details) {
    return details.approvalScope === 'creation' && details.kind === 'permission'
      && !details.questions && providers.includes(details.provider) && !!this.account();
  }
  request({signal, ...details}) {
    if (this.closed || signal?.aborted) return Promise.resolve(false);
    const account = this.account(), canRemember = this.canRemember(details);
    if (canRemember && this.settings()[details.provider]) return Promise.resolve(true);
    return new Promise(resolve => {
      const id = randomUUID(), expiresAt = Date.now() + this.timeoutMs;
      const abort = () => this.finish(id, false, 'approval-expired');
      const timer = setTimeout(abort, this.timeoutMs);
      this.pending.set(id, {resolve, timer, signal, abort, account, canRemember, details, expiresAt});
      signal?.addEventListener('abort', abort, {once: true});
      this.notify({...details, type: 'approval', id, canRemember, expiresAt});
    });
  }
  finish(id, answer, type = 'approval-resolved') {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.signal?.removeEventListener('abort', pending.abort);
    pending.resolve(answer);
    this.notify({type, id});
  }
  allowPending(account, provider, exceptId) {
    for (const [id, pending] of this.pending) {
      if (id !== exceptId && pending.account === account && pending.canRemember && pending.details.provider === provider) {
        if (this.onAutomaticAnswer) this.onAutomaticAnswer(id);
        else this.finish(id, true);
      }
    }
  }
  answer({id, answer, remember = false}) {
    const pending = this.pending.get(id);
    if (!pending) throw Error('请求已结束');
    if (pending.account !== this.account()) throw Error('账号已切换，请重新发起操作');
    if (answer && typeof answer === 'object') answer = validateRuntimeAnswer(pending.details, answer);
    if (remember) {
      if (answer !== true || !pending.canRemember) throw Error('此请求不能设置为始终允许');
      // Persist successfully before approving any waiting operation.
      this.settings({provider: pending.details.provider, alwaysAllow: true}, id);
      this.finish(id, true);
    } else this.finish(id, answer);
    return {ok: true};
  }
  close() {
    this.closed = true;
    for (const id of this.pending.keys()) this.finish(id, false, 'approval-expired');
  }
}
