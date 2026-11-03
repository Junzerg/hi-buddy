---
description: "Run local substitutes for Haier IAM, personal API keys and the model gateway while developing the real Web application."
---

# Haier service simulator

English | [中文](README.zh.md)

## Summary

Develop the real Web application outside the intranet using simulated Haier accounts, personal API keys, model discovery and streaming replies. Docker runs the simulated upstream services beside the application's existing company-login exchange service. No real IAM credentials or model calls are required.

## Table of Contents

- [Start](#start)
- [Scenarios](#scenarios)
- [Development data and boundaries](#boundaries)
- [Checks](#checks)

<a id="start"></a>

## Start

Install the repository dependencies with pnpm and use Node >=24.9. Docker Engine and Docker Compose must be available. The normal Web development entry builds artifacts and starts its source watchers. Stop existing repository watchers before starting another development loop.

From the repository root:

```sh
pnpm --dir haier-simulator run up
pnpm run dev:web --haier
```

Open the authenticated Web URL printed by the second command. The Web workspace stays hidden behind a mandatory sign-in dialog until IAM authentication succeeds. Click Sign in to reach the simulated Haier IAM page. Select a simulated account and approve login. The real Host exchanges the authorization code, saves the profile, discovers the simulated model and selects it. Sign out through the application's account controls to clear its account grant and company models.

The service console is at `http://127.0.0.1:18080`. The existing login exchange listens at `http://127.0.0.1:18081/company-login/exchange`. The Web Host uses `127.0.0.1:3080`, matching the simulator's explicitly configured callback. Desktop development and installed Desktop retain the company IAM callback on port 18743. Occupied ports cause startup to fail; the launcher does not stop other applications.

When the browser runs on another machine, forward ports 3080 and 18080 from the development machine to that browser's machine, keeping the same loopback ports. Both the Web URL and IAM URL must be reachable from the browser. The Host itself calls the exchange on port 18081; that port needs no browser forwarding.

To reuse existing artifacts, add the normal development entry's `--skip-build` option:

```sh
pnpm run dev:web --haier --skip-build
```

Run one set of repository watchers at a time. Ctrl+C stops the Web process and its watchers; the Docker services remain available. Stop those services with:

```sh
pnpm --dir haier-simulator run down
```

<a id="scenarios"></a>

## Scenarios

The IAM page offers normal login, denied authorization, an expired authorization code, and failures at the token, user-profile, personal-key or model-list boundary. Close the IAM tab and cancel from the application's login controls to exercise cancellation. Leaving the attempt pending exercises the application's existing login deadline.

Two synthetic accounts expose different names, emails and department paths. The gateway returns one model, `haier-simulator`, with deterministic Chinese replies in ordinary JSON or OpenAI-compatible SSE. Replies identify themselves as simulated; they do not perform inference or generate tool calls. Reported token usage is fixed test data.

Use **Reset simulated credentials** in the service console to invalidate all issued codes, IAM tokens and personal keys. The next model request receives HTTP 401. The application detects invalid credentials when it makes a request, rather than receiving a simulator-specific push notification.

<a id="boundaries"></a>

## Development data and boundaries

Simulator source, Compose configuration and development connection settings live here. Generated exchange bundles go under `.build/`; the isolated Harness home and writable Web profile go under `.state/`. Both directories are Git-ignored. Profile settings and conversation history persist across Web restarts. Simulator credentials live in container memory; restarting the simulated service requires signing in again when the application next detects its old key is invalid.

The simulator matches the Haier interfaces consumed by this application: IAM authorize/token/userInfo, personal-key getOrCreate, model listing and chat completions. The company-login container runs a bundle of the [existing exchange service](../apps/desktop/scripts/company-login-server.ts). Its original internal personal-key hostname resolves to the simulated service inside the Compose network. Application secrets are fixed synthetic values; no production secret files are read.

The normal `pnpm run dev:web --haier` entry reads this directory's development settings; without `--haier`, it uses the normal Harness home. Windows packaging does not reference the simulator. It changes no production endpoint or IAM requirement. The `--haier` profile enables the Web application's mandatory IAM entry: loading, sign-out and expired or non-IAM credentials retain the login dialog, while IAM success restores access. Desktop's mandatory IAM window remains owned by Electron. Enterprise SSO cookies, MFA, real IAM policy, real model output and Windows shell behavior still need intranet acceptance. Application sign-out clears its local grant; it does not perform global IAM single sign-out.

<a id="checks"></a>

## Checks

Run the HTTP contract tests and the Docker test separately:

```sh
pnpm --dir haier-simulator run test
pnpm --dir haier-simulator run test:docker
```

The Docker test starts its own Compose project with OS-assigned host ports, uses the real exchange service, and removes its containers and network on completion. It requires Docker and may download the Node base image on its first run.

With the simulator Web Host running, the following command accepts its printed authenticated startup URL and checks real account RPC, authorization callback, profile, model discovery, cancellation and sign-out cleanup. It signs out the simulated account before and after the check:

```sh
node haier-simulator/smoke.mjs 'http://127.0.0.1:3080/?token=<printed-token>'
```

## Dev Note

None.
