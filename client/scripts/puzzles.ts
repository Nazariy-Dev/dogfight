// П'ять головоломок порядку задача/мікрозадача. node scripts/puzzles.js
// (5-та, з requestAnimationFrame, — у браузері: scripts/puzzle-raf.html)
const out: string[] = []
const log = (s: string): void => void out.push(s)
const wait = () => new Promise((r) => setTimeout(r, 20))

async function p1() {
  // await віддає керування навіть на не-промісі
  async function f() {
    log('A')
    await 0
    log('B')
  }
  f()
  log('C')
  await wait()
}
async function p2() {
  // setTimeout усередині .then — задача, створена з мікрозадачі
  setTimeout(() => log('T1'), 0)
  Promise.resolve().then(() => {
    log('M1')
    setTimeout(() => log('T2'), 0)
    queueMicrotask(() => log('M2'))
  })
  log('S')
  await wait()
}
async function p3() {
  // повернення промісу з then додає два «такти» мікрозадач
  Promise.resolve()
    .then(() => {
      log('a1')
      return Promise.resolve()
    })
    .then(() => log('a2'))
  Promise.resolve()
    .then(() => log('b1'))
    .then(() => log('b2'))
    .then(() => log('b3'))
    .then(() => log('b4'))
  await wait()
}
async function p4() {
  // виконавець new Promise синхронний; resolve двічі — другий ігнорується
  new Promise<string>((res) => {
    log('exec')
    res('first')
    res('second')
  }).then((v) => log(v))
  log('after')
  await wait()
}

for (const [name, fn] of Object.entries({ p1, p2, p3, p4 })) {
  out.length = 0
  await fn()
  console.log(`${name}: ${out.join(' ')}`)
}
