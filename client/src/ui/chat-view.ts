import type { Connection } from '../net/connection.ts'

/** Панель чату й списку гравців. */
export function mountChat(root: HTMLElement, conn: Connection): HTMLElement {
  const box = document.createElement('div')
  box.className = 'chat'
  box.innerHTML = `<div class="roster"></div><div class="msgs"></div>
    <form><input maxlength="200" placeholder="Enter — чат"><button>Send</button></form>
    <div class="net muted"></div>`
  root.append(box)
  const pick = <E extends Element>(sel: string): E => {
    const el = box.querySelector<E>(sel)
    if (!el) throw new Error(sel)
    return el
  }
  const roster = pick<HTMLDivElement>('.roster')
  const msgs = pick<HTMLDivElement>('.msgs')
  const input = pick<HTMLInputElement>('input')
  const net = pick<HTMLDivElement>('.net')
  conn.on(
    'roster',
    (m) => (roster.textContent = 'У кімнаті: ' + m.players.map((p) => p.name).join(', ')),
  )
  conn.on('chat', (m) => {
    const line = document.createElement('div')
    line.textContent = `${m.from}: ${m.text}`
    msgs.append(line)
    msgs.scrollTop = msgs.scrollHeight
  })
  conn.on('status', (d) => {
    net.textContent =
      d.status === 'reconnecting'
        ? `з'єднання втрачено, повтор через ${d.delay ?? 0} мс`
        : d.status
  })
  conn.on('shutdown', () => (net.textContent = 'сервер перезапускається…'))
  pick<HTMLFormElement>('form').addEventListener('submit', (e) => {
    e.preventDefault()
    const text = input.value.trim()
    if (text) conn.send({ type: 'chat', text })
    input.value = ''
    input.blur()
  })
  input.addEventListener('keydown', (e) => e.stopPropagation())
  return box
}
