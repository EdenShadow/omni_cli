# 技能凭据依赖与团队钥匙库

创建、注册或发布技能时，由技能作者声明实际需要的凭据。使用时，读取当前请求发起人在此项目选用的钥匙串；未选择时使用最早上传且有权访问的一组。每次执行前重新 resolve，不缓存明文跨任务使用，也不以执行电脑主人或会话创建者代替本轮发起人。技能名称、依赖 ID 是精确关联，不按名称猜测其他技能或其他团队的密钥。

## 发布时声明

在技能根目录创建 `wanwu.credentials.json`，跟随技能一起版本化和同步。`skill` 必须等于 SKILL.md 的 name。没有凭据依赖的技能填写 `credentials: []`。旧技能没有该文件仍可同步，但不会自动得到任何钥匙；编辑它并发布新版后才能配置。

```json
{
  "schemaVersion": 1,
  "skill": "my-service-skill",
  "credentials": [
    {
      "id": "service-account",
      "label": "服务账号",
      "description": "调用生成接口所需的团队账号",
      "setupUrl": "https://example.com/account",
      "fields": [
        {"id": "api_key", "label": "API Key", "secret": true, "required": true, "env": "SERVICE_API_KEY"},
        {"id": "user_id", "label": "用户 ID", "secret": false, "required": true, "env": "SERVICE_USER_ID"}
      ]
    }
  ]
}
```

一个技能可声明多个依赖；同一依赖可由不同成员保存多组账号，每人独立选择，不影响其他成员。把必须配套使用的用户 ID 和 API Key 放在同一依赖的 fields 中，避免跨组混用。账号密码可定义 `username` / `password` 两个字段。`secret`、`required` 默认 true；`env` 仅在脚本需要环境变量时填写。声明只包含定义，不能包含 value、default、token、真实账号或密码。使用真实服务的配置入口替换示例链接；没有入口则省略。改变字段定义后，旧凭据标记待重新配置，避免把旧账号误用于新接口。

用户在技能面板加号旁点击钥匙进入钥匙库。列表只显示有权访问的组，包含上传者、可见范围、配置状态和自己的选择，不回传任何实际字段值。可先保存部分内容，稍后补填。新增组默认全团队可见并可使用；上传者可设为仅自己或指定当前团队成员，自己始终有权使用。只有上传者可改可见范围；项目创建者可维护全团队共享组，但不能越权读取其他成员的私有或受限组。不能把用户聊天里偶然出现的密码自动保存为团队凭据。

## 使用时读取

在依赖凭据的技能 SKILL.md 中写明：使用前沿用本轮范围，调用钥匙库；在脚本内部消费凭据，不向聊天、日志或附件输出实际值。同步技能只同步声明和脚本，不同步实际密钥。

只看配置状态（不返回密钥）：

```sh
node /absolute/wanwu-skills-sync/scripts/sync.mjs --scope REQUEST_ID credentials-status --skill my-service-skill
```

脚本需要环境变量时，创建不含密钥的执行计划，`command` 和 `cwd` 为绝对路径，`args` 为字符串数组：

```json
{"command":"/absolute/node","args":["/absolute/my-service-skill/scripts/generate.mjs"],"cwd":"/absolute/workspace"}
```

```sh
node /absolute/wanwu-skills-sync/scripts/sync.mjs --scope REQUEST_ID credentials-run --skill my-service-skill --dependency service-account --input /absolute/plan.json
```

默认读取本轮发起人选定的整组账号。仅在用户明确要求本次使用另一组时加 `--entry ENTRY_ID`，仍需满足可见权限；不要擅自覆盖用户选择。所选组删除或撤权时返回错误，要求用户重新选择，不自动换成团队账号。未选过时才自动使用最早可见组；没有组或所选组缺字段时返回 setup-required。旧默认值在首次服务端升级时迁移为已有成员的个人选择，新加入成员按最早可见组选择。声明的 env 注入子进程，不写入 shell 参数或磁盘；命令不使用 shell。输出有大小和 5 分钟超时限制，并替换原始凭据值；脚本仍须避免输出编码后的凭据。不要把密码塞进执行计划。Windows executable 使用 `C:/.../node.exe`；macOS 使用本机 Node 的绝对路径。

需要直接调用 HTTP 或 SDK 时，在技能的 Node 脚本中导入本技能安装目录的 `scripts/credentials.mjs`：

```js
import {pathToFileURL} from 'node:url';
// Windows 使用 C:/...，macOS 使用 /...；以文件 URL 导入可同时兼容两端。
const {resolveSkillCredentials} = await import(pathToFileURL('/absolute/wanwu-skills-sync/scripts/credentials.mjs').href);
const credentials = await resolveSkillCredentials({skill:'my-service-skill',dependency:'service-account',scope:requestId});
if (credentials.status !== 'ready') {
  // 返回配置提示；不要继续调用需要认证的接口。
  return credentials;
}
// 在内存里用 credentials.values.api_key / user_id 调用明确指定的服务。
// 不要 console.log(credentials)，也不要把凭据送到无关域名。
```

范围参数也可用 `context`、`project`、`runtime`；遵循本技能的运行时选择规则。授权、网络或服务错误抛出异常，不能当成“没有账号”。只有 `setup-required` 才进入缺失配置流程，返回缺失字段及可选配置网址。技能若支持注册，可以按用户已授权的任务执行其注册流程；注册涉及费用、验证码或额外授权时，交给用户完成。不要因暂时不可用自动重复注册。此版本的运行时接口只读，新增或保存凭据在钥匙面板完成。
