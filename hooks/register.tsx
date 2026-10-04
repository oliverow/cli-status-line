// cli-status-line: the CLI status line (~/.claude/statusline-command.sh) drawn
// as a band above the prompt in the desktop app, which has no status line.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Seg } from '../types'

const line = atom({ plugin: 'cli-status-line', key: 'line' } as const, null)
const effort = atom({ plugin: 'cli-status-line', key: 'effort' } as const, null)
// When the last main-loop response arrived; the prompt cache expires CACHE_TTL_MS after it
const cacheAt = atom({ plugin: 'cli-status-line', key: 'cacheAt' } as const, null)
// The button runs macOS `open`, so it shows only where the session runs on a Mac
const isMac = atom({ plugin: 'cli-status-line', key: 'isMac' } as const, false)

const CACHE_TTL_MS = 60 * 60 * 1000
const REFRESH_MS = 60 * 1000
const FETCH_MS = 10 * 60 * 1000
// The macOS app the button opens the session's folder in
const EDITOR_APP = 'Visual Studio Code - Insiders'

// stdout, or null when git failed
async function git($: EngineInterface, dir: string, ...args: string[]) {
  const r = await $.process.run(['git', '-C', dir, ...args], { timeoutMs: 5000 })
  return r.exitCode === 0 ? r.stdout : null
}

async function gitSegs($: EngineInterface, dir: string): Promise<Seg[]> {
  const branch = await git($, dir, 'symbolic-ref', '--short', 'HEAD')
  if (branch === null) return []
  const segs: Seg[] = [{ text: branch.trim(), dim: true }]
  // Commits ahead/behind upstream, as of the last fetch
  const counts = await git($, dir, 'rev-list', '--left-right', '--count', '@{upstream}...HEAD')
  if (counts !== null) {
    const [behind, ahead] = counts.trim().split(/\s+/).map(Number)
    if (ahead > 0) segs.push({ text: ` ↑${ahead}`, color: 'magenta' })
    if (behind > 0) segs.push({ text: ` ↓${behind}`, color: 'magenta' })
  }
  let s = 0, m = 0, u = 0
  for (const l of ((await git($, dir, 'status', '--porcelain')) ?? '').split('\n')) {
    if (/^\?\?/.test(l)) { u++; continue }
    if (/^.[MADRCU]/.test(l)) m++
    if (/^[MADRCU]/.test(l)) s++
  }
  if (s) segs.push({ text: ` +${s}`, color: 'green' })
  if (m) segs.push({ text: ` ~${m}`, color: 'yellow' })
  if (u) segs.push({ text: ` ?${u}`, color: 'red' })
  return segs
}

// GPU: one "<index><state>" token per GPU (f free, m mine, o another user's) and when it was read
let hasGpu = false
let gpuBusy = false
let gpuAt = 0
let gpuTokens: string[] = []

// nvidia-smi blocks forever when the driver lock is wedged, and no kill ends it.
// So at most one query is ever in flight: one that hangs (the call times out and
// rejects) leaves gpuBusy set until the module reloads, and the line shows `gpu:?`
// once the last reading is two minutes old. A query that fails is tried next minute.
async function queryGpu($: EngineInterface) {
  if (gpuBusy) return
  gpuBusy = true
  const apps = await $.process.run(['nvidia-smi', '--query-compute-apps=gpu_uuid,pid', '--format=csv,noheader'])
  const gpus = await $.process.run(['nvidia-smi', '--query-gpu=index,uuid,memory.used', '--format=csv,noheader,nounits'])
  if (apps.exitCode === 0 && gpus.exitCode === 0) {
    const rows = apps.stdout.split('\n').filter(Boolean).map(l => l.split(/,\s*/))
    const me = await $.env.get('USER')
    const owners = rows.length
      ? (await $.process.run(['ps', '-o', 'pid=,user=', '-p', rows.map(r => r[1]).join(',')])).stdout
      : ''
    const myPids = new Set(owners.split('\n').map(l => l.trim().split(/\s+/)).filter(([, u]) => u === me).map(([p]) => p))
    const mine = new Set(rows.filter(([, pid]) => myPids.has(pid)).map(([uuid]) => uuid))
    const used = new Set(rows.map(([uuid]) => uuid))
    gpuTokens = gpus.stdout.split('\n').filter(Boolean).map(l => {
      const [i, uuid, mem] = l.split(/,\s*/)
      return i + (mine.has(uuid) ? 'm' : Number(mem) >= 1024 || used.has(uuid) ? 'o' : 'f')
    })
    gpuAt = await $.clock.now()
  }
  gpuBusy = false
  await refresh($)
}

async function refresh($: EngineInterface) {
  const [dir, model, usage, now, home] = await Promise.all([
    $.session.cwd(), $.session.model(), $.session.usage(), $.clock.now(), $.env.get('HOME'),
  ])
  const parts: Seg[][] = []

  // ~/.claude behind its remote
  if (Number(await git($, `${home}/.claude`, 'rev-list', '--count', 'HEAD..@{upstream}')) > 0) {
    parts.push([{ text: '📥' }])
  }

  parts.push([{ text: dir.split('/').pop() ?? dir, color: 'blue' }])
  const g = await gitSegs($, dir)
  if (g.length) parts.push(g)

  const pct = Math.floor(usage.context.percent ?? 0)
  const mid: Seg[] = [{ text: model, dim: true }]
  const eff = await read($, effort)
  if (eff !== null) mid.push({ text: ` ${eff}`, dim: true })
  mid.push({ text: ` ${pct}%`, color: pct >= 90 ? 'red' : pct >= 70 ? 'yellow' : 'green' })
  const at = await read($, cacheAt)
  if (at !== null) {
    const left = at + CACHE_TTL_MS - now
    if (left <= 0) mid.push({ text: ' cache cold', color: 'red' })
    else {
      const mins = Math.ceil(left / 60000)
      mid.push({ text: ' cache', dim: true }, { text: ` ${mins}m`, color: mins <= 5 ? 'yellow' : 'green' })
    }
  }
  parts.push(mid)

  if (hasGpu) {
    const label: Seg = { text: 'gpu', color: 'cyan' }
    if (now - gpuAt >= 120_000) parts.push([label, { text: ':?', dim: true }])
    else if (gpuTokens.length) {
      parts.push([label, { text: ':', dim: true }, ...gpuTokens.map(t => ({
        text: t.slice(0, -1),
        color: t.endsWith('f') ? 'green' : t.endsWith('m') ? 'red' : 'gray',
      }))])
    }
  }

  const mins = Math.floor((now - usage.startedAt) / 60000)
  let dur = mins >= 60 ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}m` : `${mins}m`
  if (usage.cost) dur += ` $${usage.cost.usd.toFixed(2)}`
  parts.push([{ text: dur, dim: true }])

  const segs = parts.flatMap((p, i) => (i ? [{ text: ' | ', dim: true }, ...p] : p))
  await update($, line, () => segs)
}

async function fetchConfig($: EngineInterface) {
  const home = await $.env.get('HOME')
  await $.process.run(['git', '-C', `${home}/.claude`, 'fetch', '-q'], {
    env: { GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' },
    timeoutMs: 30000,
  })
  await refresh($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    const os = (await $.process.run(['uname'])).stdout.trim()
    await update($, isMac, () => os === 'Darwin')
    hasGpu = (await $.process.run(['sh', '-c', 'command -v nvidia-smi'])).exitCode === 0
    if (hasGpu) {
      $.clock.after(0, () => void queryGpu($))
      $.clock.every(REFRESH_MS, () => void queryGpu($))
    }
    $.clock.after(0, () => void refresh($))
    $.clock.after(0, () => void fetchConfig($))
    $.clock.every(FETCH_MS, () => void fetchConfig($))
    $.clock.every(REFRESH_MS, () => void refresh($))
    return r
  })

  // Each main-loop response: note the effort it ran at and restart the cache clock
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    await update($, effort, () => (e.effort === undefined ? null : String(e.effort)))
    const r = yield* next(e)
    const t = await $.clock.now()
    await update($, cacheAt, () => t)
    $.clock.after(0, () => void refresh($))
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // The terminal draws the real status line
    if (e.surface !== 'desktop' || e.props.hasSurvey) return next(e)
    const segs = await read($, line)
    if (segs === null) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const openInEditor = async () => {
      const r = await $.process.run(['open', '-a', EDITOR_APP, await $.session.cwd()])
      if (r.exitCode !== 0) $.ui.toast(r.stderr.trim())
    }
    const text = (
      <Text wrap="truncate">
        {segs.map(s => <Text color={s.color} dimColor={s.dim}>{s.text}</Text>)}
      </Text>
    )
    if (!(await read($, isMac))) return <Box>{text}</Box>
    return (
      <Box>
        {text}
        <Text> </Text>
        <Button key="editor" label="Open in VS Code" onPress={openInEditor} />
      </Box>
    )
  })
}
