import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeRun } from './lib/report.js'
import { mergeVerdicts, type LlmVerdict } from './lib/escalate.js'
import type { RunResult } from './lib/case.js'

/** Ré-ingère une adjudication LLM dans un dossier de run : lit run.json + un fichier de
 *  LlmVerdict[], fusionne via mergeVerdicts, et réécrit report.md/details.json/escalation.json/run.json. */
export function applyAdjudication(dir: string, llmVerdictsPath: string): void {
  const run = JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8')) as RunResult
  const llm = JSON.parse(readFileSync(llmVerdictsPath, 'utf8')) as LlmVerdict[]
  const merged: RunResult = { ...run, verdicts: mergeVerdicts(run.verdicts, llm) }
  writeRun(dir, merged)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dir, llmPath] = process.argv.slice(2)
  if (!dir || !llmPath) {
    console.error('usage: uat:adjudicate <run-dir> <llm-verdicts.json>')
    process.exitCode = 1
  } else {
    applyAdjudication(dir, llmPath)
    console.log(`adjudication appliquée → ${dir}`)
  }
}
