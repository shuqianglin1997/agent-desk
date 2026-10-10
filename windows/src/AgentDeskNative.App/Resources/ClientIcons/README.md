# 客户端图标

仅用于客户端识别及独立演示模式。PNG 原样提取自本机已验证 MSIX 客户端的可执行文件图标：OpenAI.Codex 26.1007.2314.0 / Claude 2.31226.0.0。标识属于各自供应商。

`codex-dark.png` 取自同一 Codex 包的 `Square44x44Logo.targetsize-32_altform-unplated.png`，供深色主题使用。正常运行时优先读取已安装包 `assets` 下的 light/unplated 图标（按主题选择），其次读取用户已安装客户端的 exe 图标并在进程内缓存；未安装或不可读时使用这份识别图，最终才回退首字母。演示模式使用此资源，不读取真实客户端或用户数据。
