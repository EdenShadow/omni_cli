export function validateGithubSource(value) {
  if (!value || value.type !== 'github' || !/^[a-zA-Z0-9-]{1,100}$/.test(value.owner) || !/^[\w.-]{1,100}$/.test(value.repo) || ['.','..'].includes(value.repo)) throw Error('GitHub 仓库信息无效');
  if (typeof value.ref !== 'string' || !value.ref || value.ref.length > 200 || /[\x00-\x20?#\\]/.test(value.ref) || value.ref.split('/').some(p=>!p||p==='.'||p==='..')) throw Error('GitHub 分支信息无效');
  const directory=value.directory;
  if (typeof directory!=='string' || directory.length>500 || /[\x00-\x1f\\]/.test(directory) || (directory && directory.split('/').some(p=>!p||p==='.'||p==='..'))) throw Error('GitHub 技能目录无效');
  if (!/^[a-f0-9]{40}$/.test(value.commit)) throw Error('GitHub 提交版本无效');
  return {type:'github',owner:value.owner,repo:value.repo,ref:value.ref,directory,commit:value.commit};
}
export const githubSourceUrl = s => `https://github.com/${s.owner}/${s.repo}/tree/${encodeURIComponent(s.ref)}${s.directory?'/'+s.directory.split('/').map(encodeURIComponent).join('/'):''}`;
