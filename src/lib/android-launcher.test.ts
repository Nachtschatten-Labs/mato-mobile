import { afterEach, describe, expect, it } from 'vitest'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findJava17 } from '../../scripts/android.mjs'

const temporaryDirectories: string[] = []
function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'mato-jdk-test-'))
  temporaryDirectories.push(directory)
  return directory
}

function fakeJdk(home: string, version = '17.0.20', compiler = true) {
  mkdirSync(join(home, 'bin'), { recursive: true })
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
  writeFileSync(
    join(home, 'bin', 'java'),
    `#!/bin/sh\nprintf '%s\\n' ${quote(`java.version = ${version}`)} ${quote(`java.home = ${home}`)} >&2\n`,
  )
  chmodSync(join(home, 'bin', 'java'), 0o755)
  if (compiler) writeFileSync(join(home, 'bin', 'javac'), '')
  return home
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

// These fixtures are executable POSIX shell scripts; Windows uses the same resolver.
describe.skipIf(process.platform === 'win32')('Android JDK selection', () => {
  it('honors a verified JAVA_HOME before the Java on PATH', () => {
    const root = temporaryDirectory()
    const preferred = fakeJdk(join(root, 'preferred JDK'))
    const fallback = fakeJdk(join(root, 'other'))
    expect(
      findJava17({
        env: {
          NODE_ENV: 'test',
          JAVA_HOME: preferred,
          PATH: join(fallback, 'bin'),
        },
        platform: 'linux',
        roots: [],
      }),
    ).toBe(preferred)
  })

  it('ignores JAVA_HOME pointing at Java 25 and resolves Java 17 from PATH', () => {
    const root = temporaryDirectory()
    const studio = fakeJdk(join(root, 'studio'), '25.0.3')
    const supported = fakeJdk(join(root, 'supported'))
    expect(
      findJava17({
        env: {
          NODE_ENV: 'test',
          JAVA_HOME: studio,
          PATH: join(supported, 'bin'),
        },
        platform: 'linux',
        roots: [],
      }),
    ).toBe(supported)
  })

  it('finds a Gradle-provisioned macOS JDK without requiring system registration', () => {
    const root = temporaryDirectory()
    const cache = join(root, 'gradle', 'jdks')
    fakeJdk(join(cache, 'a-unsupported', 'Contents', 'Home'), '25.0.3')
    const supported = fakeJdk(
      join(cache, 'b-adoptium-17', 'jdk-17', 'Contents', 'Home'),
    )
    expect(
      findJava17({
        env: { NODE_ENV: 'test', PATH: root },
        platform: 'linux',
        roots: [cache],
      }),
    ).toBe(supported)
  })

  it('rejects a Java runtime without a JDK compiler', () => {
    const root = temporaryDirectory()
    const runtime = fakeJdk(join(root, 'runtime'), '17.0.20', false)
    expect(
      findJava17({
        env: { NODE_ENV: 'test', JAVA_HOME: runtime, PATH: root },
        platform: 'linux',
        roots: [root],
      }),
    ).toBeNull()
  })

  it('does not search past three installation directory levels', () => {
    const root = temporaryDirectory()
    fakeJdk(join(root, 'one', 'two', 'three', 'four'))
    expect(
      findJava17({
        env: { NODE_ENV: 'test', PATH: root },
        platform: 'linux',
        roots: [root],
      }),
    ).toBeNull()
  })
})
