# Demo Document B: Simulator Notes for Search Checks

> Purpose: a second fixture for the local document library. It exercises English
> tokenisation, mixed CJK/ASCII lines, and cross-document hits with [Demo A](demo-a-doclib-notes.md).
> Shared keyword for both files: `doclib`, `demo`.

## 1. Why a second demo file

One file proves the indexer runs. Two files prove the index can *rank and group* —
a query should return hits from both documents, with the correct file, line number,
and workspace attribution for each. A single fixture hides grouping bugs.

The content below is intentionally ordinary: a short service note that looks like a
real engineering memo, so the chunker sees realistic paragraph lengths.

## 2. Service topology

The simulator stands in for three upstream services during local development:

| Service | Port | Replacement for | Notes |
| --- | --- | --- | --- |
| `iam` | 7201 | corporate identity | issues fixed test accounts |
| `keys` | 7202 | personal API keys | seeded from fixtures |
| `gateway` | 7203 | model gateway | streams canned replies |

Nothing here talks to a real intranet endpoint. Credentials in fixtures are fake,
and the gateway returns deterministic text so runs stay comparable.

### 2.1 Startup order

Start `iam` first, then `keys`, then `gateway`: the gateway resolves account records
through both of the others at boot and exits early if either is unreachable.

```bash
docker compose -f compose.yaml up --build
```

### 2.2 Failure modes worth testing

- **Gateway first**: expect a startup abort with a clear dependency message.
- **Wrong key seed**: `keys` returns 401 for every account; the gateway surfaces 502.
- **Port collision**: any of the three ports taken locally; the compose file fails fast.

## 3. What this document is *not*

This is a **demo fixture**, not an operations runbook. Do not copy numbers or ports
into production documentation. The only durable claim is the layering order, which
mirrors the real topology: identity → keys → gateway.

## 4. Verification queries

Run these after the file is indexed:

1. `simulator` — should hit multiple sections of this file only.
2. `doclib` — should hit **both** demo documents.
3. `gateway` — should hit the table and section 2.1.
4. `docker compose` — should hit the code block.

## 5. Closing note

If a query returns the right file but a slightly wrong offset, the chunker is fine and
the line mapping is off. If it returns nothing at all, the file simply may not be
indexed yet — check index freshness before editing the fixture.
