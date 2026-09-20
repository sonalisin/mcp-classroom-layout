// Drives the real (built) app through the core workflow via the DevTools
// protocol: create class -> add students -> generate seating -> manual move ->
// rename -> restart -> verify persistence. Run with: node scripts/smoke-e2e.mjs
import { spawn } from 'node:child_process'

const ELECTRON = './node_modules/electron/cli.js'
const PORT = 9223

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForPage() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const pages = await res.json()
      const page = pages.find((p) => p.type === 'page' && p.title.includes('Seating'))
      if (page) return page.webSocketDebuggerUrl
    } catch {}
    await sleep(500)
  }
  throw new Error('App page never appeared')
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const msgId = ++id
      pending.set(msgId, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)))
      ws.send(JSON.stringify({ id: msgId, method, params }))
    })
  return new Promise((resolve) => {
    ws.onopen = () => resolve(call)
  })
}

async function evalJs(call, expression) {
  const result = await call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (result.exceptionDetails) {
    throw new Error('Eval failed: ' + JSON.stringify(result.exceptionDetails))
  }
  return result.result.value
}

const ui = `
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const setVal = (el, v) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
`

async function evalInPage(call, fn) {
  return evalJs(call, `(async () => { ${ui} ${fn} })()`)
}

async function main() {
  console.log('1. launching app...')
  const app = spawn('node', [ELECTRON, '.', `--remote-debugging-port=${PORT}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  })
  const errLog = []
  app.stderr.on('data', (d) => errLog.push(d.toString()))
  try {
    let call = await connect(await waitForPage())

    console.log('2. creating class...')
    await evalInPage(call, `
      setVal($('input[placeholder="New class name"]'), 'Smoke Class 1');
      $('button').click();
      return true;
    `)
    await evalInPage(call, `return new Promise(r => { const c = () => $('select option') ? r(true) : setTimeout(c, 200); c(); })`)

    console.log('3. adding 5 students...')
    for (const name of ['Alice', 'Bob', 'Carol', 'Dave', 'Eve']) {
      await evalInPage(call, `
        setVal($('input[placeholder="Student name"]'), '${name}');
        [...$$('button')].find(b => b.textContent === 'Add').click();
        return true;
      `)
      await sleep(150)
    }
    const rosterCount = await evalInPage(call, `return $$('aside ul li').length`)
    if (rosterCount !== 5) throw new Error(`Expected 5 students, saw ${rosterCount}`)

    console.log('4. generating seating...')
    await evalInPage(call, `
      [...$$('button')].find(b => b.textContent === 'Generate seating').click();
      return true;
    `)
    await evalInPage(call, `return new Promise(r => { const c = () => $$('.seat').length >= 5 ? r(true) : setTimeout(c, 200); c(); })`)
    const seatsBefore = await evalInPage(call, `return $$('.seat').map(s => s.textContent)`)

    console.log('5. manual move: first seated student -> empty seat...')
    const emptyBefore = await evalInPage(call, `return $$('.seat.empty').length`)
    if (emptyBefore === 0) throw new Error('No empty seat available for move test')
    await evalInPage(call, `
      $$('.seat').filter(s => !s.classList.contains('empty') && !s.classList.contains('ghost'))[0].click();
      return true;
    `)
    await sleep(250)
    await evalInPage(call, `$('.seat.empty').click(); return true;`)
    await sleep(400)
    const seatsAfter = await evalInPage(call, `return $$('.seat').map(s => s.textContent)`)
    if (seatsBefore.join('|') === seatsAfter.join('|')) {
      throw new Error('Manual move had no effect')
    }

    console.log('5b. manual swap of two occupied seats...')
    const beforeSwap = await evalInPage(call, `return $$('.seat').map(s => s.textContent)`)
    await evalInPage(call, `
      $$('.seat').filter(s => !s.classList.contains('empty') && !s.classList.contains('ghost'))[0].click();
      return true;
    `)
    await sleep(250)
    await evalInPage(call, `
      $$('.seat').filter(s => !s.classList.contains('empty') && !s.classList.contains('ghost'))[1].click();
      return true;
    `)
    await sleep(400)
    const afterSwap = await evalInPage(call, `return $$('.seat').map(s => s.textContent)`)
    if (beforeSwap.join('|') === afterSwap.join('|')) throw new Error('Swap had no effect')

    console.log('5c. placing an unseated student...')
    await evalInPage(call, `
      setVal($('input[placeholder="Student name"]'), 'Frank');
      [...$$('button')].find(b => b.textContent === 'Add').click();
      return true;
    `)
    await sleep(300)
    await evalInPage(call, `
      return new Promise(r => { const c = () => $$('.chip').length > 0 ? r(true) : setTimeout(c, 200); c(); });
    `)
    await evalInPage(call, `
      $('.chip').click();
      return true;
    `)
    await sleep(250)
    await evalInPage(call, `
      const empty = $$('.seat.empty');
      if (empty.length === 0) return 'no-empty-seat';
      empty[0].click();
      return 'placed';
    `)
    await sleep(400)
    const emptyAfterPlace = await evalInPage(call, `return $$('.seat.empty').length`)
    if (emptyAfterPlace !== 0) throw new Error(`Unseated student was not placed (empty seats: ${emptyAfterPlace})`)

    console.log('6. renaming the moved student...')
    await evalInPage(call, `
      const occupied = $$('.seat').filter(s => !s.classList.contains('empty') && !s.classList.contains('ghost'));
      occupied[0].click();
      return true;
    `)
    await sleep(150)
    await evalInPage(call, `
      const input = $('.rename input');
      setVal(input, input.value + ' B');
      [...$$('.rename button')].find(b => b.textContent === 'Save name').click();
      return true;
    `)
    await sleep(300)
    const renamedVisible = await evalInPage(call, `
      return $$('.seat .who').some(el => el.textContent.endsWith(' B')) || $$('aside ul li').some(el => el.textContent.endsWith(' B'));
    `)
    if (!renamedVisible) throw new Error('Rename not visible in UI')

    const seatSnapshot = await evalInPage(call, `return $$('.seat').map(s => s.textContent).join('|')`)

    console.log('7. restarting app...')
    call.close?.()
    app.kill('SIGKILL')
    await sleep(1000)
    const app2 = spawn('node', [ELECTRON, '.', `--remote-debugging-port=${PORT}`], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const errLog2 = []
    app2.stderr.on('data', (d) => errLog2.push(d.toString()))
    try {
      call = await connect(await waitForPage())
      await evalInPage(call, `return new Promise(r => { const c = () => ($$('.seat').length >= 6 && $$('aside ul li').length === 6) ? r(true) : setTimeout(c, 200); c(); })`)
      const classThere = await evalInPage(call, `return $$('select option').some(o => o.textContent === 'Smoke Class 1')`)
      if (!classThere) throw new Error('Class did not persist')
      const seatSnapshot2 = await evalInPage(call, `return $$('.seat').map(s => s.textContent).join('|')`)
      if (seatSnapshot2 !== seatSnapshot) {
        throw new Error(`Seating changed after restart:\nbefore: ${seatSnapshot}\nafter:  ${seatSnapshot2}`)
      }
      const studentsThere = await evalInPage(call, `return $$('aside ul li').map(l => l.textContent).sort().join(',')`)
      if (!studentsThere.includes('B')) throw new Error('Rename did not persist: ' + studentsThere)
      console.log('   students after restart: ' + studentsThere)

      console.log('8. AI panel without key is blocked...')
      const aiEnabled = await evalInPage(call, `
        return [...$$('button')].find(b => b.textContent === 'Ask AI')?.disabled
      `)
      if (aiEnabled !== true) throw new Error('Ask AI should be disabled without an API key')
      const keyStatus = await evalInPage(call, `return $('header').textContent.includes('No API key')`)
      if (!keyStatus) throw new Error('API key status not shown')

      const rendererErrors = errLog2.filter((l) => l.includes('Uncaught') || l.includes('TypeError'))
      if (rendererErrors.length) throw new Error('Renderer errors: ' + rendererErrors.join('\n'))
    } finally {
      app2.kill('SIGKILL')
    }
    console.log('SMOKE E2E PASSED')
  } finally {
    try { app.kill('SIGKILL') } catch {}
  }
}

main().catch((e) => {
  console.error('SMOKE E2E FAILED:', e.message)
  process.exit(1)
})
