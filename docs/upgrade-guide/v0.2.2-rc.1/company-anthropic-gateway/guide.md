---
kind: upgrade-guide
description: "The company model route defaults to Anthropic Messages at the gateway root instead of OpenAI Chat Completions."
---

# Company gateway uses Anthropic Messages

English | [中文](guide.zh.md)

## Change

The built-in `company-gateway` route uses `api: anthropic-messages` and `baseURL: http://ai-gateway.haierxj.cn`. Model discovery sends Anthropic headers to `/v1/models?limit=1000`; inference uses the Anthropic Messages protocol. This replaces the OpenAI route at the `/v1` base URL.

Desktop startup backs up and repairs saved company connection overrides using the bundled defaults. Existing credentials, saved model lists and unrelated providers remain intact. Explicit OpenAI company routes remain supported by the login synchronization service.

## Migration

1. Desktop users need no manual configuration change. Restart the updated application and inspect the HaierCash provider in Models settings: its protocol is Anthropic Messages and its API address is the gateway root above.
2. Other profiles with a saved `company-gateway` override must set those two fields explicitly to adopt the new route. Preserve the existing credential reference and model IDs.
3. Verify model discovery, streaming conversation and a tool call against the gateway from the target network. A successful catalog request does not establish inference compatibility.
