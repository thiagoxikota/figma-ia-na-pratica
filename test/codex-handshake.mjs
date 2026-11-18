// Prova, no Mac e no Windows, que o bloco que o instalador grava no config.toml do Codex
// abre o servidor de verdade: lê command/args/env do arquivo, sobe o processo do mesmo
// jeito que o Codex sobe (sem shell) e faz o initialize do MCP pelo stdio.
// Uso: node test/codex-handshake.mjs <config.toml>
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

const toml = readFileSync(process.argv[2], 'utf8')
const block = toml.split(/^\s*\[mcp_servers\.figma-console\]\s*$/m)[1]?.split(/^\s*\[/m)[0] || ''
const command = JSON.parse(block.match(/^command = (.+)$/m)[1])
const args = JSON.parse(block.match(/^args = (\[.*\])$/m)[1])
const timeout = Number(block.match(/^startup_timeout_sec = (\d+)$/m)?.[1] || 10)
const envLine = block.match(/^env = \{(.*)\}$/m)?.[1] || ''
const env = Object.fromEntries([...envLine.matchAll(/(\w+) = ("(?:[^"\\]|\\.)*")/g)].map((m) => [m[1], JSON.parse(m[2])]))
console.log(`comando: ${[command, ...args].join(' ')} | startup_timeout_sec: ${timeout} | env: ${Object.keys(env).join(', ')}`)

const start = Date.now()
const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
let out = ''
let err = ''
const done = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${msg} (${((Date.now() - start) / 1000).toFixed(1)}s)`)
  if (!ok) console.log(err.slice(-1500).replace(/figd_[A-Za-z0-9_-]+/g, 'figd_***'))
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'])
    else child.kill('SIGTERM')
  } catch {}
  process.exit(ok ? 0 : 1)
}
child.on('error', (e) => done(false, `o processo não abriu: ${e.code || e.message}`))
child.on('exit', (code) => done(false, `o servidor saiu antes de responder (código ${code})`))
child.stderr.on('data', (d) => (err += d))
child.stdout.on('data', (d) => {
  out += d
  for (const line of out.split('\n')) {
    try {
      const msg = JSON.parse(line)
      if (msg.id === 1 && msg.result?.serverInfo) done(true, `handshake MCP com ${msg.result.serverInfo.name} ${msg.result.serverInfo.version}`)
    } catch {}
  }
})
child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste-codex', version: '1' } } })}\n`)
setTimeout(() => done(false, `sem resposta em ${timeout}s, o mesmo limite que o Codex usa`), timeout * 1000)
