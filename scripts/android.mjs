import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)

function jdkRoots(env, platform) {
  const home = homedir()
  return [
    join(home, '.jdks'),
    join(home, '.sdkman', 'candidates', 'java'),
    join(home, '.asdf', 'installs', 'java'),
    join(env.GRADLE_USER_HOME || join(home, '.gradle'), 'jdks'),
    ...(platform === 'darwin'
      ? [
          join(home, 'Library/Java/JavaVirtualMachines'),
          '/Library/Java/JavaVirtualMachines',
        ]
      : platform === 'linux'
        ? ['/usr/lib/jvm']
        : env.ProgramFiles
          ? ['Java', 'Eclipse Adoptium', 'Microsoft', 'Zulu'].map((name) =>
              join(env.ProgramFiles, name),
            )
          : []),
  ]
}

export function findJava17({
  env = process.env,
  platform = process.platform,
  roots = jdkRoots(env, platform),
} = {}) {
  const executable = (name) => (platform === 'win32' ? `${name}.exe` : name)
  const checked = new Set()
  function probe(command) {
    if (checked.has(command)) return null
    checked.add(command)
    const result = spawnSync(
      command,
      ['-XshowSettings:properties', '-version'],
      {
        env,
        encoding: 'utf8',
        timeout: 5_000,
        windowsHide: true,
      },
    )
    if (result.status !== 0) return null
    const output = `${result.stdout}\n${result.stderr}`
    const home = output.match(/^\s*java\.home\s*=\s*(.+)$/m)?.[1].trim()
    return /^\s*java\.version\s*=\s*17(?:[.\s-]|$)/m.test(output) &&
      home &&
      isAbsolute(home) &&
      existsSync(join(home, 'bin', executable('javac')))
      ? home
      : null
  }
  const fromEnvironment =
    env.JAVA_HOME && probe(join(env.JAVA_HOME, 'bin', executable('java')))
  if (fromEnvironment) return fromEnvironment
  const fromPath = probe(executable('java'))
  if (fromPath) return fromPath
  if (platform === 'darwin') {
    const result = spawnSync('/usr/libexec/java_home', ['-v', '17'], {
      env,
      encoding: 'utf8',
      timeout: 5_000,
    })
    const home = result.status === 0 && result.stdout.trim()
    const found = home && probe(join(home, 'bin', 'java'))
    if (found) return found
  }
  const visited = new Set()
  function search(directory, depth = 0) {
    try {
      const canonical = realpathSync(directory)
      if (visited.has(canonical)) return null
      visited.add(canonical)
      for (const home of [directory, join(directory, 'Contents', 'Home')]) {
        const java = join(home, 'bin', executable('java'))
        // A JDK is a leaf: do not scan its libraries or internal directories.
        if (existsSync(java)) return probe(java)
      }
      if (depth >= 3) return null
      for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
        (a, b) => a.name.localeCompare(b.name),
      )) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
        const found = search(join(directory, entry.name), depth + 1)
        if (found) return found
      }
    } catch {
      /* Missing/inaccessible installation roots are normal. */
    }
    return null
  }
  for (const root of roots) {
    const found = search(root)
    if (found) return found
  }
  return null
}

function main() {
  const javaHome = findJava17()
  if (!javaHome) {
    throw new Error(
      'Android builds require JDK 17. Install JDK 17 and set JAVA_HOME to its installation directory, then retry pnpm android. See https://reactnative.dev/docs/0.86/set-up-your-environment',
    )
  }
  console.log(`Using JDK 17: ${javaHome}`)
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--check-java') return
  const env = { ...process.env, JAVA_HOME: javaHome }
  const pathKey =
    Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'PATH'
  env[pathKey] = `${join(javaHome, 'bin')}${delimiter}${env[pathKey] || ''}`
  const child = spawn(
    process.execPath,
    [require.resolve('expo/bin/cli'), 'run:android', ...args],
    {
      env,
      stdio: 'inherit',
    },
  )
  const forward = (signal) => child.kill(signal)
  const signals = ['SIGINT', 'SIGTERM']
  for (const signal of signals) process.on(signal, forward)
  const cleanup = () => {
    for (const signal of signals) process.off(signal, forward)
  }
  child.once('error', (error) => {
    cleanup()
    console.error(error.message)
    process.exitCode = 1
  })
  child.once('exit', (code, signal) => {
    cleanup()
    if (signal) process.kill(process.pid, signal)
    else process.exitCode = code ?? 1
  })
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
