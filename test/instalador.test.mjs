// Testes do instalador sem terminal interativo. Rodam em Mac, Windows e Linux (CI).
// Uso: node test/instalador.test.mjs [--rede]   (--rede baixa o servidor de verdade e cria o plugin)
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const INST = join(dirname(fileURLToPath(import.meta.url)), '..', 'instalar.mjs')
const TOK = 'figd_TESTE_ci_123'
const WIN = process.platform === 'win32'
let fails = 0
const check = (name, cond, info = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`)
  if (!cond) { fails += 1; if (info) console.log(String(info).slice(-1500)) }
}

function home(withPlugin = true) {
  const h = mkdtempSync(join(tmpdir(), 'casa teste é-'))
  if (withPlugin) {
    mkdirSync(join(h, '.figma-console-mcp', 'plugin'), { recursive: true })
    writeFileSync(join(h, '.figma-console-mcp', 'plugin', 'manifest.json'), '{}')
  }
  return h
}
function run(h, { env = {}, extra = ['--sem-plugin'], cfg = true, timeout = 60000 } = {}) {
  const base = { PATH: process.env.PATH, HOME: h, USERPROFILE: h, INSTALAR_SEM_ABRIR: '1', SystemRoot: process.env.SystemRoot || '', ComSpec: process.env.ComSpec || '', PATHEXT: process.env.PATHEXT || '', TEMP: process.env.TEMP || '', TMP: process.env.TMP || '' }
  if (cfg) base.MCP_CONFIG_PATH = join(h, 'cfg', 'claude_desktop_config.json')
  const r = spawnSync(process.execPath, [INST, ...extra], { env: { ...base, ...env }, input: '', encoding: 'utf8', timeout })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}
const cfgOf = (h) => join(h, 'cfg', 'claude_desktop_config.json')
const put = (h, text) => { mkdirSync(join(h, 'cfg'), { recursive: true }); writeFileSync(cfgOf(h), text) }
const read = (p) => JSON.parse(readFileSync(p, 'utf8'))

// 1. Primeira instalação com a chave por variável de ambiente
let h = home(); let r = run(h, { env: { FIGMA_ACCESS_TOKEN: TOK } })
let c = existsSync(cfgOf(h)) ? read(cfgOf(h)) : {}
const e = c.mcpServers?.['figma-console']
check('1 instala do zero', r.code === 0 && e?.env?.FIGMA_ACCESS_TOKEN === TOK, r.out)
check('1 comando certo para o sistema', WIN ? e?.command === 'cmd' && e?.args?.join(' ') === '/c npx -y figma-console-mcp@1.35.0' : e?.command === 'npx' && e?.args?.join(' ') === '-y figma-console-mcp@1.35.0', JSON.stringify(e))
check('1 chave nunca aparece na tela', !r.out.includes(TOK), r.out)

// 2. Preserva outros conectores e preferências
h = home(); put(h, JSON.stringify({ mcpServers: { outro: { command: 'x' } }, preferences: { a: 1 } }))
r = run(h, { env: { FIGMA_ACCESS_TOKEN: TOK } }); c = read(cfgOf(h))
check('2 preserva outros conectores', r.code === 0 && c.mcpServers.outro && c.preferences?.a === 1 && readdirSync(join(h, 'cfg')).some((f) => f.includes('.bak')), r.out)

// 3. Conexão diferente já existe, sem terminal: para sem mexer (código 4)
h = home(); const orig = JSON.stringify({ mcpServers: { 'figma-console': { command: 'node', args: ['/x.js'], env: { FIGMA_ACCESS_TOKEN: 'figd_ANTIGA' } } } })
put(h, orig); r = run(h, { env: { FIGMA_ACCESS_TOKEN: TOK } })
check('3 conflito sem confirmação não mexe', r.code === 4 && readFileSync(cfgOf(h), 'utf8') === orig && !r.out.includes('figd_ANTIGA'), r.out)
r = run(h, { env: { FIGMA_ACCESS_TOKEN: TOK }, extra: ['--sem-plugin', '--substituir'] })
check('3b --substituir troca', r.code === 0 && read(cfgOf(h)).mcpServers['figma-console'].env.FIGMA_ACCESS_TOKEN === TOK, r.out)

// 4. JSON quebrado sem confirmação: para sem mexer
h = home(); put(h, '{ quebrado'); r = run(h, { env: { FIGMA_ACCESS_TOKEN: TOK } })
check('4 JSON quebrado não é apagado', r.code === 4 && readFileSync(cfgOf(h), 'utf8') === '{ quebrado', r.out)

// 5. Sem chave e sem terminal: sai com código 2, sem criar arquivo
h = home(); r = run(h)
check('5 sem chave sai limpo', r.code === 2 && !existsSync(cfgOf(h)), r.out)

// 6. Caminho padrão do sistema (sem MCP_CONFIG_PATH), com espaço e acento na pasta
h = home(); r = run(h, { env: { FIGMA_ACCESS_TOKEN: TOK, APPDATA: join(h, 'AppData', 'Roaming'), LOCALAPPDATA: join(h, 'AppData', 'Local') }, cfg: false })
const def = WIN ? join(h, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json')
  : process.platform === 'darwin' ? join(h, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  : join(h, '.config', 'Claude', 'claude_desktop_config.json')
check('6 grava no caminho padrão', r.code === 0 && existsSync(def), r.out)

// 7. Windows com Claude da Microsoft Store (MSIX): grava também na pasta virtualizada
if (WIN) {
  h = home(); const local = join(h, 'AppData', 'Local'); mkdirSync(join(local, 'Packages', 'Claude_pzs8sxrjxfjjc'), { recursive: true })
  r = run(h, { env: { FIGMA_ACCESS_TOKEN: TOK, APPDATA: join(h, 'AppData', 'Roaming'), LOCALAPPDATA: local }, cfg: false })
  const msix = join(local, 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json')
  check('7 MSIX: grava nas duas pastas', r.code === 0 && existsSync(msix) && existsSync(join(h, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json')), r.out)
  check('7 MSIX: reconhece o Claude Desktop', r.out.includes('[ok] Claude Desktop'), r.out)
}

// 7b. Codex: sem Codex na máquina, não cria nada
h = home(); r = run(h, { env: { FIGMA_ACCESS_TOKEN: TOK } })
check('7b sem Codex não cria config.toml', r.code === 0 && !existsSync(join(h, '.codex', 'config.toml')), r.out)

// 7c. Codex existe: grava o bloco, preserva o resto e troca só o nosso bloco antigo
h = home(); mkdirSync(join(h, '.codex'), { recursive: true })
const tomlPath = join(h, '.codex', 'config.toml')
writeFileSync(tomlPath, 'model = "gpt-5"\n\n[mcp_servers.figma-console]\ncommand = "node"\nargs = ["/velho.js"]\n\n[mcp_servers.figma-console.env]\nFIGMA_ACCESS_TOKEN = "figd_ANTIGA"\n\n[mcp_servers.outro]\ncommand = "x"\n')
r = run(h, { env: { FIGMA_ACCESS_TOKEN: TOK } })
const toml = existsSync(tomlPath) ? readFileSync(tomlPath, 'utf8') : ''
check('7c Codex: bloco novo com chave e tempo de partida', r.code === 0 && toml.includes(`FIGMA_ACCESS_TOKEN = "${TOK}"`) && toml.includes('startup_timeout_sec = 120') && toml.includes('figma-console-mcp@1.35.0'), toml + r.out)
check('7c Codex: preserva o resto e tira o bloco velho', toml.includes('model = "gpt-5"') && toml.includes('[mcp_servers.outro]') && !toml.includes('figd_ANTIGA') && !toml.includes('/velho.js') && (toml.match(/\[mcp_servers\.figma-console\]/g) || []).length === 1, toml)
check('7c Codex: chave nunca aparece na tela', !r.out.includes(TOK) && r.out.includes('Codex também ligado'), r.out)
check('7c caminho fixo do manifest impresso', r.out.includes('.figma-console-mcp'), r.out)

// 8. Rede: baixa o servidor de verdade e cria o plugin numa casa limpa
if (process.argv.includes('--rede')) {
  h = home(false); const t0 = Date.now()
  r = run(h, { env: { FIGMA_ACCESS_TOKEN: TOK }, extra: [], timeout: 420000 })
  const secs = Math.round((Date.now() - t0) / 1000)
  check(`8 plugin criado de verdade (${secs} s)`, r.code === 0 && existsSync(join(h, '.figma-console-mcp', 'plugin', 'manifest.json')), r.out)
}

// R. Config com texto sobrando depois do fim (erro do Claude no Windows, 18/11/2026):
// conserta sem pedir "sim", mantém a chave salva e os outros conectores, e o resultado é JSON válido.
h = home()
put(h, JSON.stringify({ mcpServers: { outro: { command: 'x' }, 'figma-console': { command: WIN ? 'cmd' : 'npx', args: WIN ? ['/c', 'npx', '-y', 'figma-console-mcp@1.35.0'] : ['-y', 'figma-console-mcp@1.35.0'], env: { FIGMA_ACCESS_TOKEN: TOK, ENABLE_MCP_APPS: 'true' } } }, preferences: { a: '{ } "' } }, null, 2) + '\n  }\n}\n')
r = run(h)
c = (() => { try { return read(cfgOf(h)) } catch { return null } })()
check('R conserta texto sobrando no fim', r.code === 0 && c?.mcpServers?.outro && c?.mcpServers?.['figma-console']?.env?.FIGMA_ACCESS_TOKEN === TOK && c?.preferences?.a === '{ } "' && /texto sobrando/.test(r.out), r.out)
check('R não deixa arquivo temporário', !readdirSync(join(h, 'cfg')).some((f) => f.includes('.tmp-')))

// P. O caso real provável: Claude já tinha o próprio config e a pessoa colou o bloco do
// plano B no fim. A chave do bloco colado vale sem pedir de novo, e nada do Claude se perde.
h = home()
{
  const entry = { command: WIN ? 'cmd' : 'npx', args: WIN ? ['/c', 'npx', '-y', 'figma-console-mcp@1.35.0'] : ['-y', 'figma-console-mcp@1.35.0'], env: { FIGMA_ACCESS_TOKEN: TOK, ENABLE_MCP_APPS: 'true' } }
  put(h, '\uFEFF' + JSON.stringify({ preferences: { tema: 'escuro' }, mcpServers: { outro: { command: 'x' } } }, null, 2) + '\n' + JSON.stringify({ mcpServers: { 'figma-console': entry } }, null, 2) + '\n')
}
r = run(h)
c = (() => { try { return read(cfgOf(h)) } catch { return null } })()
check('P bloco colado no fim: junta sem perder nada', r.code === 0 && c?.preferences?.tema === 'escuro' && c?.mcpServers?.outro && c?.mcpServers?.['figma-console']?.env?.FIGMA_ACCESS_TOKEN === TOK, r.out)
check('P não pede chave nova', /mesma/.test(r.out) && !/Vou abrir as configurações do Figma/.test(r.out), r.out)
check('P guarda cópia .bak', readdirSync(join(h, 'cfg')).some((f) => f.includes('.bak-')))

console.log(fails ? `\n${fails} falha(s)` : '\nTudo passou')
process.exit(fails ? 1 : 0)
