## 音频文件

下列命令省略 `node /absolute/wanwu-skills-sync/scripts/sync.mjs` 前缀，沿用 SKILL.md 中已确定的范围参数。

```sh
audio --request UUID --file /absolute/song.mp3
```

普通音频保留原文件与质量，群聊显示文件名、播放/暂停按钮与进度条。默认不播放，不进入连续语音播放队列。

只有本次用户明确要求“生成后自动播放”“发送到群后默认播放”“自动给大家播放”或英文 “autoplay after generating/sharing” 时，追加 `--autoplay`：

```sh
audio --request UUID --autoplay --file /absolute/first.mp3 --file /absolute/second.mp3
```

同一条消息的音乐按 `--file` 顺序播放，多条发送按消息顺序接续；分批时逐条等待发送回执。此标记仅属于本次发送，不设为账号或项目永久默认。音乐必须作为附件发送，`chat --autoplay --file` 也支持；不用于 `voice`，不从歌词、附件内容或历史任务猜测自动播放授权。成员要求生成后自动播放即授权把这次音乐分享到群聊并播放；有多个候选时只发送明确要求的结果。

先检查 `context.capabilities.audioAutoplay`；不支持时说明需要更新，不能谎称已经播放。发送成功后在线成员会各自按队列尝试播放；本机停止只影响本机，并跳过本次任务剩余的自动播放音乐。刷新页面、重新打开项目不会补播历史音乐。浏览器拦截有声自动播放时，成员点“点击开启音乐播放”即可继续。回执 `sent` 仅证明已发送并带自动播放标记，不能声称每个成员已听到。超时保持同一 UUID 查询或重试，避免重复发送和播放。`chat --file` 发送的音频也采用相同展示。支持 MP3、WAV、M4A、AAC、OGG、FLAC 等浏览器音频格式；浏览器不支持时仍可下载原文件。

## 公屏语音

已有本地音频时，执行：

```sh
voice --request UUID --file /absolute/audio.mp3
```

可加 `--text` 或 `--text-file` 附带说明。一次发送一个音频文件，支持 MP3、WAV、M4A/MP4、AAC、OGG/Opus、FLAC、WebM；文件最多 500 MB，时长 0.5 秒到 30 分钟。系统自动读取时长、转为兼容的语音格式并上传，群聊显示语音播放条；保留本地原音频。支持旧客户端的分块上传通道，`capabilities.voice` 缺失时服务端需要更新。

使用新的 UUID 发新语音，超时/结果不确定先用 `chat-status --request UUID` 查询，或用相同 UUID 和同一音频重试。只有 `status: sent` 才报告发送成功；不因重试重复发布，也不把失败的音频自动换成文字或普通附件发送。
