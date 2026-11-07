# Windows LibreOffice 引擎的可移植 VC++ 运行库

[English](README.md) | 中文

`prepare-dsh.ts` 会把本目录中所有 `msvcp140*`/`vcruntime140*` DLL 复制到每个 Windows Desktop 包中
`node_modules/@deepseek-ai/libreoffice-kit-win32-x64/bin/libreoffice-kit.exe` 的旁边。系统 MSVCP140.dll
早于引擎工具链的内网主机会让转换器以 0xC0000005 崩溃，表现为“Office 转换失败”的预览。随包分发的副本
使引擎不再依赖主机安装的运行库版本。

Windows 打包在本目录缺少 DLL 时直接失败；`DSH_DESKTOP_PORTABLE_CRT_DIR`
可以指定替代的绝对目录，但普通构建不需要任何环境变量。不要把该变量写入 `.env.windows`：配置加载器会拒绝未知变量名。

- 来源：Microsoft Visual C++ 2022 Redistributable (x64)，文件版本 14.51.36247.0，2026-11-07 引入。
- 许可：这些 DLL 按其所属可再分发包的 Visual Studio 许可条款分发（THIRD_PARTY_NOTICES.md 列出 DeepSeek OSS
  依赖；这些 Microsoft 二进制按 Microsoft 的可再分发代码条款分发）。
- 更新：下载最新 `vc_redist.x64.exe`，解压（`vc_redist.x64.exe /extract:`），把八个
  `msvcp140*`/`vcruntime140*` DLL 覆盖到此处，并在上方记录新的文件版本。
