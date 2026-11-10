/** The four model-visible tools. The count is a budget: context pays for each. */
import { createListTool } from './list.js'
import { createReadTool } from './read.js'
import { createSearchTool } from './search.js'
import { createStatusTool } from './status.js'

export function createTools(deps) {
  return [
    createSearchTool(deps),
    createReadTool(deps),
    createListTool(deps),
    createStatusTool(deps),
  ]
}
