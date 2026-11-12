---
description: "The checkout-owned document library: client source, builds, and the boundary with sibling kit packages."
kind: "package-bundle"
---

# Local document library

English | [中文](README.zh.md)

## Summary

This package owns the document library used by the Web and Desktop composition. Its source lives here; the sibling kit repository keeps historical design records only.

## Table of Contents

- [Development](#development)
- [Configuration and extension points](#configuration-and-extension-points)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="development"></a>
## Development

Edit `src/client/index.js` for presentation and `src/client/styles.css` for plugin-local styles. From the hi-buddy root, run `pnpm run build:doclib-client`; `build` and `build:artifacts` include that step. `client.js` is a committed generated bundle so the private package remains directly runnable and packable; `pnpm run verify:doclib-client` checks freshness. While `dev:web` is running, rebuild after client edits to trigger the Host's bundle reload.

The build embeds CSS and preserves the existing module-loader entry, styles, and behavior. It requires no sibling checkout or additional runtime stylesheet request. Host entry `index.js` composes the existing indexing, search, persistence, tools, and HTTP modules.

<a id="configuration-and-extension-points"></a>
## Configuration and extension points

`packages/bundle/web-app/cordis.patch.yml` mounts this package as `doclib`; its workspace dependency selects this directory. Keep the package name, exported entries, HTTP endpoints, tool names, and slot registrations stable when changing its UI. Theme variables and reusable controls belong to the host; business layout belongs to this client.

<a id="model-experience"></a>
## Model Experience

The tools `doc_search`, `doc_list`, and `doc_status` expose indexed documents. A client stylesheet or layout change does not change their schemas, results, prompt content, token use, or KV-cache behavior.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

The client retains its existing plugin-prefixed CSS and custom controls, preview dialog, and Markdown renderer. Source/style separation does not establish shared primitive adoption or complete accessibility conformance; migrate those implementations with their real interaction tests when redesigning the corresponding regions.
