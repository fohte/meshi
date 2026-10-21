import { existsSync } from 'node:fs'
import path from 'node:path'

type PathExists = (path: string) => boolean

export const resolveWebDistRoot = (
  cwd: string,
  exists: PathExists = existsSync,
): string => {
  const deployedRoot = path.resolve(cwd, 'web/dist')
  return exists(deployedRoot) ? deployedRoot : path.resolve(cwd, '../web/dist')
}
