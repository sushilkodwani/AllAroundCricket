// Takes the first-run intro screenshots (public/intro/*.jpg) from the dev server with headless Edge.
//   1. npm run dev   (port 5183)
//   2. node scripts/shoot-intro.mjs
// It fills a throw-away Edge profile with the showcase club (src/dev/seedShowcase.ts), logs in as a
// player and saves each screen at phone size (375×812, 2×). Windows + Edge only; no extra packages.
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'intro')
const APP = process.env.APP_URL ?? 'http://localhost:5183/'
const EDGE = process.env.EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9333
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- a tiny WebSocket client (Node 18 has none built in) ----------
function connect(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': randomBytes(16).toString('base64') } })
    req.on('error', reject)
    req.on('upgrade', (_res, socket) => {
      let buf = Buffer.alloc(0)
      let parts = []
      const handlers = new Set()
      socket.on('data', (d) => {
        buf = Buffer.concat([buf, d])
        for (;;) {
          if (buf.length < 2) return
          const fin = buf[0] & 0x80
          let len = buf[1] & 0x7f
          let off = 2
          if (len === 126) {
            if (buf.length < 4) return
            len = buf.readUInt16BE(2)
            off = 4
          } else if (len === 127) {
            if (buf.length < 10) return
            len = Number(buf.readBigUInt64BE(2))
            off = 10
          }
          if (buf.length < off + len) return
          parts.push(buf.subarray(off, off + len))
          buf = buf.subarray(off + len)
          if (fin) {
            const text = Buffer.concat(parts).toString('utf8')
            parts = []
            for (const h of handlers) h(JSON.parse(text))
          }
        }
      })
      const send = (obj) => {
        const data = Buffer.from(JSON.stringify(obj))
        const mask = randomBytes(4)
        const head = data.length < 126 ? Buffer.from([0x81, 0x80 | data.length]) : data.length < 65536 ? Buffer.from([0x81, 0x80 | 126, data.length >> 8, data.length & 255]) : (() => {
          const h = Buffer.alloc(10)
          h[0] = 0x81
          h[1] = 0x80 | 127
          h.writeBigUInt64BE(BigInt(data.length), 2)
          return h
        })()
        const body = Buffer.from(data.map((b, i) => b ^ mask[i % 4]))
        socket.write(Buffer.concat([head, mask, body]))
      }
      let id = 0
      const call = (method, params = {}) =>
        new Promise((res, rej) => {
          const my = ++id
          const h = (msg) => {
            if (msg.id !== my) return
            handlers.delete(h)
            msg.error ? rej(new Error(`${method}: ${msg.error.message}`)) : res(msg.result)
          }
          handlers.add(h)
          send({ id: my, method, params })
        })
      resolve({ call, close: () => socket.destroy() })
    })
    req.end()
  })
}

async function json(path) {
  for (let i = 0; i < 50; i++) {
    try {
      return await new Promise((res, rej) => http.get(`http://127.0.0.1:${PORT}${path}`, (r) => {
        let s = ''
        r.on('data', (d) => (s += d))
        r.on('end', () => res(JSON.parse(s)))
      }).on('error', rej))
    } catch {
      await sleep(200)
    }
  }
  throw new Error('Edge did not start')
}

const profile = mkdtempSync(join(tmpdir(), 'aac-intro-'))
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, 'about:blank'], { stdio: 'ignore' })

try {
  const pages = await json('/json/list')
  const page = pages.find((p) => p.type === 'page')
  const cdp = await connect(page.webSocketDebuggerUrl)
  await cdp.call('Page.enable')
  await cdp.call('Runtime.enable')
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true })
  await cdp.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
  const evaluate = async (expression) => {
    const r = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }
  const go = async (hash, wait = 2200) => {
    await cdp.call('Page.navigate', { url: `${APP}#${hash}` })
    await sleep(wait)
  }

  // Fill the profile with the club season, logged in as a player.
  await cdp.call('Page.navigate', { url: APP })
  await sleep(2500)
  const seeded = await evaluate(`import('/src/dev/seedShowcase.ts').then(m => m.seedShowcase()).then(r => JSON.stringify(r.results))`)
  console.log('seeded', seeded)
  // Never show the intro itself in its own screenshots.
  await evaluate(`localStorage.setItem('aac.pref.introSeen', 'true'); 1`)
  await cdp.call('Page.reload')
  await sleep(2500)

  const ids = JSON.parse(
    await evaluate(`(() => {
      const d = JSON.parse(localStorage.getItem('aac.demo.showcase'))
      const J = (k) => JSON.parse(d[k].text)
      const team = J('teams.json').teams[0]
      const ms = J('teams/' + team.id + '/matches.json').matches
      const me = JSON.parse(localStorage.getItem('aac.session')).personId
      const big = ms.filter(m => m.scoring === 'finished' && m.result === 'won').sort((a, b) => b.date.localeCompare(a.date))[0]
      return JSON.stringify({ team: team.id, me, live: ms.find(m => m.scoring === 'live').id, done: big.id, next: ms.find(m => !m.scoring && m.lifecycle === 'scheduled').id })
    })()`),
  )
  const t = `/teams/${ids.team}`
  const shots = [
    ['home', '/teams'],
    ['live', `${t}/matches/${ids.live}/live`],
    ['scorecard', `${t}/matches/${ids.done}/live?tab=scorecard`],
    ['analysis', `${t}/matches/${ids.done}/live?tab=analysis`, 'Partnerships'],
    ['detailed', `${t}/matches/${ids.done}/live?tab=detailed`, 'Wagon wheel'],
    ['player', `${t}/players/${ids.me}`, 'Current form', 175],
    // Compare: pick the captain from the photo picker first.
    ['compare', `${t}/players/${ids.me}?ptab=compare`, 'Batting figures', 320, `(async () => {
      [...document.querySelectorAll('button')].find(b => b.textContent.includes('Pick a player')).click()
      await new Promise(r => setTimeout(r, 600))
      ;[...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent.includes('Rohan Deshpande')).click()
      await new Promise(r => setTimeout(r, 800))
      return 1
    })()`],
    ['team-stats', `${t}?tab=stats`],
    ['availability', `${t}/matches/${ids.next}`],
    ['funds', '/funds'],
  ]
  mkdirSync(OUT, { recursive: true })
  for (const [name, hash, scrollTo, above = 72, prep] of shots) {
    await go(hash)
    if (prep) await evaluate(prep)
    if (scrollTo) {
      // Bring a section to the top, just under the sticky header (`above` = how much to show over it).
      await evaluate(`(() => { const el = [...document.querySelectorAll('h2,h3')].find(h => h.textContent.trim() === ${JSON.stringify(scrollTo)}); if (el) { el.scrollIntoView(); window.scrollBy(0, -${above}) } return !!el })()`)
      await sleep(500)
    }
    const { data } = await cdp.call('Page.captureScreenshot', { format: 'jpeg', quality: 82 })
    writeFileSync(join(OUT, `${name}.jpg`), Buffer.from(data, 'base64'))
    console.log('saved', name)
  }
  cdp.close()
} finally {
  // Edge starts helper processes: close the whole tree.
  spawnSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' })
}
