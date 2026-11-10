#!/usr/bin/env node
/**
 * Search-output golden: records the exact ordered results for the fixed query
 * set so a follow-up refactor can prove it changed nothing observable.
 *
 *   node scripts/golden.mjs --record
 *   node scripts/golden.mjs --check
 *
 * The recorded file is a snapshot of the current index shape; it is not a
 * ranking target. Re-record only when an ordering change is intended.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { corpusAt, prepareSearch } from './lib/library.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const kitRoot = path.resolve(here, '..')
const defaultRoot = path.resolve(kitRoot, '..', '..', '..', 'docs')
const goldenFile = path.join(kitRoot, 'evals', 'golden-docs.json')

function parseArgs(argv) {
  const args = { root: defaultRoot, record: false, check: false, limit: 5 }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--root') args.root = path.resolve(argv[++i])
    else if (flag === '--index') args.index = path.resolve(argv[++i])
    else if (flag === '--queries') args.queries = path.resolve(argv[++i])
    else if (flag === '--limit') args.limit = Math.max(1, Number(argv[++i]) || 5)
    else if (flag === '--record') args.record = true
    else if (flag === '--check') args.check = true
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.record && !args.check) {
    console.log('usage: node scripts/golden.mjs --record|--check [--root <dir>] [--index <file>]')
    return
  }
  const queriesFile = args.queries || path.join(kitRoot, 'evals', 'queries.json')
  const queries = JSON.parse(await fs.readFile(queriesFile, 'utf8')).queries
  const { corpus, shape } = await corpusAt({ root: args.root, indexPath: args.index })
  const search = prepareSearch(corpus)

  const snapshot = {
    version: 1,
    shape,
    limit: args.limit,
    queries: queries.map((entry) => ({
      query: entry.query,
      results: search(entry.query, args.limit).results.map((hit) => ({
        rel: hit.rel,
        name: hit.name,
        score: hit.score,
        line: hit.line,
      })),
    })),
  }

  if (args.record) {
    await fs.writeFile(goldenFile, `${JSON.stringify(snapshot, null, 2)}\n`)
    console.log(`recorded ${snapshot.queries.length} queries from ${shape} into ${path.relative(kitRoot, goldenFile)}`)
    return
  }

  const recorded = JSON.parse(await fs.readFile(goldenFile, 'utf8'))
  try {
    assert.deepEqual(snapshot.queries, recorded.queries, 'search output changed')
    console.log(`golden ok: ${snapshot.queries.length} queries unchanged`)
  } catch (error) {
    console.error(String(error.message || error))
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error?.stack || String(error))
  process.exitCode = 1
})
