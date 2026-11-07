# Portable VC++ runtime for the Windows LibreOffice engine

`prepare-dsh.ts` copies every `msvcp140*`/`vcruntime140*` DLL from this directory beside
`node_modules/@deepseek-ai/libreoffice-kit-win32-x64/bin/libreoffice-kit.exe` in each Windows
Desktop package. Intranet hosts whose system MSVCP140.dll predates the engine's toolchain
crash the converter with 0xC0000005, which surfaces as "Office conversion failed" previews.
The bundled copy satisfies the engine regardless of the host's installed runtime.

Windows packaging fails closed when this directory is missing its DLLs; `DSH_DESKTOP_PORTABLE_CRT_DIR`
may name an alternative absolute directory, but no environment variable is required for an
ordinary build. Do not add the variable to `.env.windows`: the settings loader rejects unknown names.

- Source: Microsoft Visual C++ 2022 Redistributable (x64), file version 14.51.36247.0, vendored 2026-11-07.
- License: the DLLs are distributable under the Visual Studio licensing terms that govern the
  redistributable they ship with (THIRD_PARTY_NOTICES.md lists DeepSeek OSS dependencies; these
  Microsoft binaries are redistributed under Microsoft's redistributable-code terms).
- Update: download the latest `vc_redist.x64.exe`, extract it (`vc_redist.x64.exe /extract:`),
  copy the eight `msvcp140*`/`vcruntime140*` DLLs over the ones here, and record the new file
  version above.
