/**
 * Extension knowledge for the document library: which files are text at all,
 * and which of the four admission classes a document belongs to.
 *
 * `typeClass` is an admission decision, not a label: the search path hides
 * `code` by default so that a source tree scanned as a "library" does not
 * dilute prose documents. The mapping lives here and nowhere else.
 */

/** Extensions the plugin can decode as searchable text. */
export const TEXT_EXTENSIONS = new Set([
  '.md', '.markdown', '.mdx', '.txt', '.text', '.log', '.rst', '.adoc', '.org',
  '.json', '.jsonl', '.ndjson', '.yaml', '.yml', '.toml', '.ini', '.csv', '.tsv',
  '.html', '.htm', '.xml', '.svg', '.css', '.scss',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.svelte',
  '.py', '.sh', '.bash', '.ps1', '.bat', '.cmd', '.sql', '.go', '.rs', '.java', '.c', '.h', '.cpp',
])

/** Source code: admitted to the library but hidden from default search. */
export const CODE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.svelte', '.py',
  '.go', '.rs', '.java', '.kt', '.swift', '.rb', '.php', '.c', '.h', '.cpp',
  '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd', '.sql', '.css', '.scss',
])

/** Machine configuration: searchable, but not prose. */
export const CONFIG_EXTENSIONS = new Set([
  '.json', '.jsonl', '.ndjson', '.yaml', '.yml', '.toml', '.ini', '.xml', '.svg', '.html', '.htm',
])

/** Tabular or log-shaped data. */
export const DATA_EXTENSIONS = new Set([
  '.csv', '.tsv', '.log',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.pdf', '.doc', '.docx', '.xlsx', '.zip',
])

export const TYPE_CLASSES = Object.freeze(['doc', 'code', 'config', 'data'])

/** Lowercased extension for a file name, including the leading dot. */
export function extensionOf(name) {
  const value = String(name || '')
  const at = value.lastIndexOf('.')
  if (at < 0) return ''
  return value.slice(at).toLowerCase()
}

/** Whether the document's text can be decoded and indexed. */
export function isTextPath(name) {
  return TEXT_EXTENSIONS.has(extensionOf(name))
}

/** Admit a document into exactly one class; unknown extensions stay readable prose. */
export function typeClassOf(name) {
  const ext = extensionOf(name)
  if (CODE_EXTENSIONS.has(ext)) return 'code'
  if (CONFIG_EXTENSIONS.has(ext)) return 'config'
  if (DATA_EXTENSIONS.has(ext)) return 'data'
  return 'doc'
}

/**
 * Default visibility for search. `code` is admitted but hidden: 61 of 70
 * records in the original corpus were agent-written source, which crowds out
 * the documents the library exists for.
 */
export function isVisiblyDefault(typeClass) {
  return typeClass !== 'code'
}

/** Read a stored typeClass, deriving it when an older index omitted the field. */
export function normalizeTypeClass(value, name) {
  return TYPE_CLASSES.includes(value) ? value : typeClassOf(name)
}
