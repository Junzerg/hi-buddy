#!/usr/bin/env node
/**
 * Acceptance harness for the parts of P1 that cannot be seen in the panel:
 *
 *   1. a scanned document's absolute path is real (the `[object Object]` bug);
 *   2. a rebuild re-reads only the changed file;
 *   3. a session write and a folder scan of the same file are one document;
 *   4. three sessions writing one file produce one row with three sessionIds;
 *   5. rebuilding never rewrites `context.jsonl`, and index persistence refuses
 *      to target it;
 *   6. search returns that one row, with the `sessionIds` count attached.
 *
 * Runs the production modules against a temporary corpus; no harness needed.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildRuntimeView } from '../index/aggregate.js'
import { absOfPathKey, comparablePath } from '../shared/pathKey.js'
import { resolveDocumentRef } from '../index/lookup.js'
import { createIndexStore, migrateLegacyIndex } from '../store/index-store.js'
import { indexCorpus, openLibrary, prepareSearch } from './lib/library.mjs'

const results = []
async function check(name, run) {
  try {
    await run()
    results.push({ name, ok: true })
    console.log(`✓ ${name}`)
  } catch (error) {
    results.push({ name, ok: false })
    console.log(`✗ ${name}\n  ${error?.message || error}`)
  }
}

async function makeRoot(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'doclib-check-'))
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, text, 'utf8')
  }
  return root
}

async function main() {
  const root = await makeRoot({
    'a.md': '# Alpha\n\n第一个文档的内容 alpha-token。\n',
    'sub/b.md': '# Beta\n\n第二个文档 beta-token。\n',
    'noise/notes.txt': 'notes 文本 gamma-token\n',
  })
  const indexPath = path.join(root, '.doclib-index.json')
  const contextPath = path.join(root, '.doclib', 'context.jsonl')

  await check('扫描文档的绝对路径是真实路径', async () => {
    const library = openLibrary({ root, indexPath, contextPath })
    const { index } = await library.build({ sessionSource: null })
    const docs = Object.values(index.docs)
    assert.equal(docs.length, 3, 'expected three documents')
    for (const doc of docs) {
      assert.ok(doc.pathKey.startsWith('folder:'), `unexpected pathKey ${doc.pathKey}`)
      const abs = absOfPathKey(doc.pathKey, { rootPath: root })
      await fs.stat(abs)
      assert.ok(!abs.includes('[object'), 'absolute path must not be a handle string')
      assert.ok(doc.contentHash.startsWith('sha256:'), 'content hash recorded')
      assert.ok(doc.fingerprint.includes(':'), 'fingerprint recorded')
    }
  })

  await check('重建只重读被改动的文件', async () => {
    let reads = []
    const library = openLibrary({
      root,
      indexPath,
      contextPath,
      onReadText: (abs) => reads.push(comparablePath(abs)),
    })
    const first = await library.build({ sessionSource: null })
    assert.equal(first.stats.reread, 3, 'first build reads everything')

    reads = []
    const second = await library.build({ sessionSource: null, previous: first.index })
    assert.equal(reads.length, 0, `unchanged corpus must not be read again, read ${reads.join(', ')}`)
    assert.equal(second.stats.reused, 3)

    await fs.writeFile(path.join(root, 'a.md'), '# Alpha\n\n改写后的内容 delta-token。\n', 'utf8')
    reads = []
    const dirty = new Set([comparablePath(path.join(root, 'a.md'))])
    const third = await library.build({ sessionSource: null, previous: second.index, dirtyPaths: dirty })
    assert.deepEqual(reads, [comparablePath(path.join(root, 'a.md'))], `only a.md should be read, got ${reads.join(', ')}`)
    assert.equal(third.stats.reused, 2)
  })

  await check('会话写入与目录扫描命中同一条记录', async () => {
    const library = openLibrary({ root, indexPath, contextPath })
    const abs = path.join(root, 'a.md')
    const sessionSource = {
      async collect() {
        return {
          mode: 'sessions',
          truncated: false,
          workspaces: [{ id: 'w1', title: '工作区', path: root }],
          sessions: [{
            id: 's1', title: '会话', createdAt: 1, updatedAt: 10, live: false, error: null, workspaceId: 'w1',
          }],
          docs: [{
            pathKey: 'wb:w1/a.md',
            abs,
            rel: 'a.md',
            name: 'a.md',
            ext: '.md',
            typeClass: 'doc',
            kind: 'generated',
            sessionId: 's1',
            updatedAt: 10,
          }],
        }
      },
    }
    const { index } = await library.build({ sessionSource })
    const keys = Object.keys(index.docs)
    assert.deepEqual(
      keys.filter((key) => key.endsWith('/a.md')),
      ['wb:w1/a.md'],
      `folder scan must not duplicate a session document, got ${keys.join(', ')}`,
    )
    assert.ok(keys.includes('wb:w1/sub/b.md'), 'workspace attribution applies to folder hits too')
    assert.equal(index.mode, 'sessions')
  })

  await check('同一文件三个会话 → 一条记录、三个出处', async () => {
    const shared = path.join(root, 'shared.md')
    await fs.writeFile(shared, '# Shared\n\n多个会话写入的文档。\n', 'utf8')
    const library = openLibrary({ root, indexPath, contextPath })
    const sessions = [
      { id: 's1', title: '一', updatedAt: 30, workspaceId: 'w1' },
      { id: 's2', title: '二', updatedAt: 20, workspaceId: 'w1' },
      { id: 's3', title: '三', updatedAt: 10, workspaceId: 'w1' },
    ]
    const sessionSource = {
      async collect() {
        return {
          mode: 'sessions',
          truncated: false,
          workspaces: [{ id: 'w1', title: '工作区', path: root }],
          sessions: sessions.map((session) => ({ ...session, createdAt: 1, live: false, error: null })),
          docs: sessions.map((session) => ({
            pathKey: 'wb:w1/shared.md',
            abs: shared,
            rel: 'shared.md',
            name: 'shared.md',
            ext: '.md',
            typeClass: 'doc',
            kind: 'generated',
            sessionId: session.id,
            updatedAt: session.updatedAt,
          })),
        }
      },
    }
    const { index } = await library.build({ sessionSource, includeFolder: false })
    const doc = index.docs['wb:w1/shared.md']
    assert.ok(doc, 'one document survives')
    assert.deepEqual(doc.sessionIds, ['s1', 's2', 's3'], 'sessionIds ordered newest first')
    const view = buildRuntimeView(index, { rootPath: root })
    const listed = view.workspaces.flatMap((workspace) => workspace.sessions.flatMap((session) => session.documents))
    assert.equal(listed.filter((entry) => entry.key === 'wb:w1/shared.md').length, 1, 'rendered exactly once')
    assert.equal(view.byPathKey.get('wb:w1/shared.md').sessionCount, 3)

    const corpus = await indexCorpus(index, library.chunkStore, { rootPath: root })
    const search = prepareSearch(corpus)
    const hits = search('多个会话写入', 5).results.filter((hit) => hit.rel === 'shared.md')
    assert.equal(hits.length, 1, 'search returns one row per document')
    assert.equal(hits[0].sessionCount, 3)
    assert.equal(search('多个会话写入', 5).results[0].key, 'wb:w1/shared.md')
  })

  await check('重建不触碰 context.jsonl，索引写目标受守卫', async () => {
    const library = openLibrary({ root, indexPath, contextPath })
    await library.contextStore.appendMany([
      { type: 'captured', pathKey: 'folder:a.md', sessionId: '', actor: 'system' },
      { type: 'read', pathKey: 'folder:a.md', sessionId: 's1', actor: 'agent', detail: { offset: 0 } },
    ])
    const before = await library.contextStore.digest()
    assert.ok(before, 'context file exists')

    const previous = await library.load()
    const rebuilt = await library.build({ sessionSource: null, previous: previous.index })
    await library.indexStore.write(rebuilt.index)
    const after = await library.contextStore.digest()
    assert.equal(after, before, 'context bytes must not change across a rebuild')

    const guarded = createIndexStore({
      fs: library.fs,
      indexPath: contextPath,
      policy: { mode: 'workspace-write', workspaceRoot: root },
      contextPath,
      rootPath: root,
      logger: { info() {}, warn() {} },
    })
    await assert.rejects(() => guarded.write(rebuilt.index), /context\.jsonl/, 'index write must refuse the context path')

    const events = await library.contextStore.documentContext('folder:a.md')
    assert.equal(events.length, 2)
    assert.deepEqual(events.map((event) => event.type), ['captured', 'read'])
  })

  await check('doc_read 可按路径解析未归档文档', async () => {
    const library = openLibrary({ root, indexPath, contextPath })
    const { index } = await library.build({ sessionSource: null })
    const view = buildRuntimeView(index, { rootPath: root })
    const common = { byPathKey: view.byPathKey, documents: view.documents, rootPath: root, cwd: root }

    const byAbsolute = resolveDocumentRef({ path: path.join(root, 'a.md'), ...common })
    assert.equal(byAbsolute?.key, 'folder:a.md', 'absolute path resolves to the scanned document')

    const byRelative = resolveDocumentRef({ path: 'a.md', ...common })
    assert.equal(byRelative?.key, 'folder:a.md', 'workspace-relative path resolves too')

    const byKey = resolveDocumentRef({ key: 'folder:a.md', ...common })
    assert.equal(byKey?.key, 'folder:a.md')
  })

  await check('v2 假 path 在迁移时被修复', async () => {
    const migrated = migrateLegacyIndex({
      version: 2,
      mode: 'sessions',
      generatedAt: 1,
      workspaces: [{
        id: 'folder',
        title: '本地文档目录',
        path: root,
        sessions: [{
          id: 'folder',
          title: '未归档文档',
          documents: [{
            key: 'abc123',
            name: 'a.md',
            kind: 'folder',
            rel: 'a.md',
            path: '[object Object]',
            searchable: true,
            chunks: [{ line: 1, text: 'alpha' }],
          }],
        }],
      }],
    }, { rootPath: root })
    assert.ok(migrated, 'v2 index migrates')
    const doc = migrated.docs['folder:a.md']
    assert.ok(doc, 'location key replaces the hash key')
    assert.equal(doc.contentHash, '', 'migrated records are marked unread')
    assert.equal(doc.searchable, true)
  })

  await check('上传文档写入索引再读回仍保留文件名', async () => {
    const library = openLibrary({ root, indexPath, contextPath })
    const sessionSource = {
      async collect() {
        return {
          mode: 'sessions',
          truncated: false,
          workspaces: [{ id: 'w1', title: '工作区', path: root }],
          sessions: [{
            id: 's1', title: '会话', createdAt: 1, updatedAt: 2, live: false, error: null, workspaceId: 'w1',
          }],
          docs: [{
            pathKey: 'attachment:att1',
            kind: 'image',
            name: 'pic.png',
            ext: '.png',
            typeClass: 'data',
            size: 1234,
            updatedAt: 2,
            sessionId: 's1',
            attachment: { attachmentId: 'att1', name: 'pic.png', mediaType: 'image/png', bytes: 1234 },
          }],
        }
      },
    }
    const { index } = await library.build({ sessionSource, includeFolder: false })
    await library.indexStore.write(index)
    const reloaded = await library.load()
    const doc = reloaded.index.docs['attachment:att1']
    assert.ok(doc, 'attachment survives the round trip')
    assert.equal(doc.name, 'pic.png', 'file name is recovered from the attachment descriptor')
    assert.equal(doc.ext, '.png')
  })

  await check('引用图只保留库内已知路径', async () => {
    const refRoot = await makeRoot({
      'guide.md': '# Guide\n\nSee [deploy](deploy.sh) and `docs/missing.md`.\n',
      'deploy.sh': '#!/bin/sh\necho hi\n',
    })
    const library = openLibrary({
      root: refRoot,
      indexPath: path.join(refRoot, '.doclib-index.json'),
      contextPath: path.join(refRoot, '.doclib', 'context.jsonl'),
    })
    const { index } = await library.build({ sessionSource: null })
    const guide = Object.values(index.docs).find((doc) => doc.name === 'guide.md')
    assert.deepEqual(guide.refs, ['deploy.sh'], `unexpected refs ${JSON.stringify(guide.refs)}`)
  })

  const failed = results.filter((entry) => !entry.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(error?.stack || String(error))
  process.exitCode = 1
})
