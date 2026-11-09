#!/usr/bin/env node
/**
 * Retrieval baseline: `hit@1 / hit@3 / dup@1` in one command.
 *
 * The expected file is matched by `rel` (or by name when a record has no rel).
 * `dup@1` counts repeated locations inside the first three results — with a
 * single copy of every document it must be zero, so a regression in aggregation
 * shows up here rather than in a subjective read of the panel.
 *
 *   node scripts/eval.mjs --root docs
 *   node scripts/eval.mjs --index /tmp/index-v2.json --json
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { corpusAt, prepareSearch } from './lib/library.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const kitRoot = path.resolve(here, '..')

function parseArgs(argv) {
  const args = { root: path.join(kitRoot, '..', '..', '..', 'docs'), json: false, limit: 5, includeCode: false }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--root') args.root = path.resolve(argv[++i])
    else if (flag === '--index') args.index = path.resolve(argv[++i])
    else if (flag === '--queries') args.queries = path.resolve(argv[++i])
    else if (flag === '--limit') args.limit = Math.max(1, Number(argv[++i]) || 5)
    else if (flag === '--include-code') args.includeCode = true
    else if (flag === '--json') args.json = true
    else if (flag === '--help' || flag === '-h') args.help = true
  }
  return args
}

function locate(results, expected) {
  return results.findIndex((hit) => (hit.rel || '') === expected || (!hit.rel && hit.name === expected))
}

async function loadQueries(file) {
  const raw = JSON.parse(await fs.readFile(file, 'utf8'))
  const list = Array.isArray(raw) ? raw : raw.queries
  if (!Array.isArray(list) || !list.length) throw new Error(`no queries in ${file}`)
  return list
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('usage: node scripts/eval.mjs [--root <dir>] [--index <file>] [--queries <file>] [--limit 5] [--include-code] [--json]')
    return
  }
  const queriesFile = args.queries || path.join(kitRoot, 'evals', 'queries.json')
  const indexPath = args.index || path.join(args.root, '.doclib-index.json')
  const queries = await loadQueries(queriesFile)
  // A missing cache is built into the OS temp directory: measuring the corpus
  // must not write into the corpus.
  const { corpus, shape } = await corpusAt({ root: args.root, indexPath: args.index })

  const search = prepareSearch(corpus)
  const rows = []
  for (const entry of queries) {
    const results = search(entry.query, args.limit, { includeCode: args.includeCode }).results
    const at1 = locate(results.slice(0, 1), entry.expect) === 0
    const at3 = locate(results.slice(0, 3), entry.expect) >= 0
    const first = (results[0]?.rel || results[0]?.name || '')
    const dup1 = results.slice(0, 3).filter((hit) => (hit.rel || hit.name) === first).length - 1
    rows.push({
      query: entry.query,
      expect: entry.expect,
      top: results.slice(0, 3).map((hit) => hit.rel || hit.name),
      hit1: at1,
      hit3: at3,
      dup1: Math.max(0, dup1),
    })
  }

  const summary = {
    shape,
    index: indexPath,
    documents: corpus.documents.length,
    searchable: corpus.documents.filter((doc) => doc.searchable && (corpus.chunks.get(doc.pathKey) || []).length).length,
    queries: rows.length,
    hit1: rows.filter((row) => row.hit1).length / rows.length,
    hit3: rows.filter((row) => row.hit3).length / rows.length,
    dup1: rows.reduce((total, row) => total + row.dup1, 0),
  }

  if (args.json) {
    console.log(JSON.stringify({ summary, rows }, null, 2))
    return
  }

  const percent = (value) => `${(value * 100).toFixed(0)}%`
  console.log(`index ${shape}: ${summary.documents} docs / ${summary.searchable} searchable`)
  console.log(`hit@1 ${percent(summary.hit1)}  hit@3 ${percent(summary.hit3)}  dup@1 ${summary.dup1}`)
  for (const row of rows) {
    const mark = row.hit1 ? '✓' : row.hit3 ? '△' : '✗'
    console.log(`${mark} ${row.query}  →  ${row.top.join(' | ') || '(no hit)'}  [expect ${row.expect}]`)
  }
}

main().catch((error) => {
  console.error(error?.stack || String(error))
  process.exitCode = 1
})
