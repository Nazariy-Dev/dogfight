/** Панель чату й списку гравців поверх гри. */
export function mountChat(root, conn) {
  const box = document.createElement('div')
  box.className = 'chat'
  box.innerHTML = `<div class="roster"></div><div class="msgs"></div>
    <form><input maxlength="200" placeholder="Enter — чат"><button>Send</button></form>
    <div class="net muted"></div>`
  root.append(box)
  const roster = box.querySelector('.roster')
  const msgs = box.querySelector('.msgs')
  const input = box.querySelector('input')
  const net = box.querySelector('.net')
  conn.addEventListener('roster', (e) => {
    roster.textContent = 'У кімнаті: ' + e.detail.players.map((p) => p.name).join(', ')
  })
  conn.addEventListener('chat', (e) => {
    const line = document.createElement('div')
    line.textContent = `${e.detail.from}: ${e.detail.text}`
    msgs.append(line)
    msgs.scrollTop = msgs.scrollHeight
  })
  conn.addEventListener('status', (e) => {
    const d = e.detail
    net.textContent =
      d.status === 'reconnecting'
        ? `з'єднання втрачено, повтор через ${d.delay} мс`
        : d.status
  })
  conn.addEventListener('shutdown', () => (net.textContent = 'сервер перезапускається…'))
  box.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault()
    const text = input.value.trim()
    if (text) conn.send({ type: 'chat', text })
    input.value = ''
    input.blur()
  })
  // клавіші в полі чату не мають керувати кораблем
  input.addEventListener('keydown', (e) => e.stopPropagation())
  return box
}
