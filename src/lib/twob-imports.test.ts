import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { address, createNoopSigner } from '@solana/kit'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  getUpdateBooksInstruction,
  TWOB_ANCHOR_PROGRAM_ADDRESS,
} from './generated/twob'
import { TWOB_ANCHOR_PROGRAM_ADDRESS as barrelAddress } from './generated/twob/src/generated/programs'
import { TWOB_ANCHOR_PROGRAM_ADDRESS as moduleAddress } from './generated/twob/src/generated/programs/twobAnchor'

const clientDirectory = fileURLToPath(
  new URL('./generated/twob', import.meta.url),
)

function runtimeDependencies(file: string): string[] {
  // Erase type-only imports before inspecting the graph that Metro executes.
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ESNext,
    },
  })
  const source = ts.createSourceFile(file, outputText, ts.ScriptTarget.ESNext)
  return source.statements.flatMap((statement) => {
    if (
      !ts.isImportDeclaration(statement) &&
      !ts.isExportDeclaration(statement)
    ) {
      return []
    }
    const specifier = statement.moduleSpecifier
    if (
      !specifier ||
      !ts.isStringLiteral(specifier) ||
      !specifier.text.startsWith('.')
    ) {
      return []
    }
    const target = resolve(dirname(file), specifier.text)
    const dependency = [`${target}.ts`, resolve(target, 'index.ts')].find(
      existsSync,
    )
    if (!dependency)
      throw new Error(`Cannot resolve ${specifier.text} from ${file}`)
    return [dependency]
  })
}

describe('generated TWOB client imports', () => {
  it('has no runtime import or re-export cycles', () => {
    const visited = new Set<string>()
    const stack: string[] = []

    function visit(file: string) {
      const cycleStart = stack.indexOf(file)
      if (cycleStart !== -1) {
        const cycle = [...stack.slice(cycleStart), file]
          .map((path) => relative(clientDirectory, path))
          .join(' -> ')
        throw new Error(`Runtime import cycle: ${cycle}`)
      }
      if (visited.has(file)) return
      visited.add(file)
      stack.push(file)
      for (const dependency of runtimeDependencies(file)) visit(dependency)
      stack.pop()
    }

    visit(resolve(clientDirectory, 'index.ts'))
  })

  it('preserves the public program address exports', () => {
    expect(TWOB_ANCHOR_PROGRAM_ADDRESS).toBe(
      'TwobwMYkKbT8uMWqgPrEPXTPoyYsKAPmaWun6T2WT4A',
    )
    expect(barrelAddress).toBe(TWOB_ANCHOR_PROGRAM_ADDRESS)
    expect(moduleAddress).toBe(TWOB_ANCHOR_PROGRAM_ADDRESS)
  })

  it('builds update-books instructions with the default or overridden program address', () => {
    const accountAddress = address('11111111111111111111111111111111')
    const input = {
      signer: createNoopSigner(accountAddress),
      market: accountAddress,
      currentInterval: accountAddress,
      previousInterval: accountAddress,
      referenceIndex: 1n,
      slot: 10n,
    }

    expect(getUpdateBooksInstruction(input).programAddress).toBe(
      TWOB_ANCHOR_PROGRAM_ADDRESS,
    )
    expect(
      getUpdateBooksInstruction(input, { programAddress: accountAddress })
        .programAddress,
    ).toBe(accountAddress)
  })
})
