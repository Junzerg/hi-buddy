/** Device-local acknowledgement of observed Session completions. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

const STORAGE_KEY = 'dsh.session.completions.v1'

interface CompletionRecord {
  readonly id: SessionId
  readonly running: boolean
  readonly unread: boolean
}

function isRecord(value: unknown): value is CompletionRecord {
  if (typeof value !== 'object' || value === null) return false
  return 'id' in value && typeof value.id === 'string' && value.id.length > 0
    && 'running' in value && typeof value.running === 'boolean'
    && 'unread' in value && typeof value.unread === 'boolean'
}

/** One window's saved running baseline and unread acknowledgements. */
export class CompletionNotifications {
  private readonly records = new Map<SessionId, CompletionRecord>()
  private dirty = false

  constructor() {
    try {
      if (typeof localStorage === 'undefined') return
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw === null) return
      const saved: unknown = JSON.parse(raw)
      if (!Array.isArray(saved) || !saved.every(isRecord)) throw new Error('Invalid task notification records')
      for (const record of saved) this.records.set(record.id, record)
    } catch (error) {
      console.error('Task notification state could not be restored:', error)
    }
  }

  /**
   * Read one task's saved completion state.
   * @param id - task identity.
   * @returns its saved status, or undefined before observation.
   */
  get(id: SessionId): CompletionRecord | undefined { return this.records.get(id) }
  /**
   * Enumerate the tasks retained by this window.
   * @returns identities in the saved completion records.
   */
  ids(): IterableIterator<SessionId> { return this.records.keys() }

  /**
   * Record an observed task state for the next flush.
   * @param id - observed task.
   * @param running - current run state.
   * @param unread - unacknowledged completion.
   */
  set(id: SessionId, running: boolean, unread: boolean): void {
    const previous = this.records.get(id)
    if (previous?.running === running && previous.unread === unread) return
    this.records.set(id, { id, running, unread })
    this.dirty = true
  }

  /**
   * Remove deleted tasks after the catalog settles.
   * @param present - identities in the ready catalog.
   */
  retain(present: ReadonlySet<SessionId>): void {
    for (const id of this.records.keys()) {
      if (present.has(id)) continue
      this.records.delete(id)
      this.dirty = true
    }
  }

  /** Persist one settled update, rather than writing once per catalog row. */
  flush(): void {
    if (!this.dirty) return
    this.dirty = false
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.records.values()]))
      }
    } catch (error) {
      console.error('Task notification state could not be saved:', error)
    }
  }
}
