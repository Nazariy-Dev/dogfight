/** DOM-представлення лобі. Слухає події Lobby, сам мережі не торкається. */
export function mountLobbyView(root, lobby) {
  root.innerHTML = `
    <div class="lobby">
      <h1>Dogfight</h1>
      <label>Ім'я <input id="name" maxlength="16" value="pilot"></label>
      <ul id="rooms"><li class="muted">Завантаження кімнат…</li></ul>
      <p id="status" class="muted"></p>
    </div>`
  const list = root.querySelector('#rooms')
  const status = root.querySelector('#status')
  const nameInput = root.querySelector('#name')

  const onRooms = (e) => {
    status.textContent = `Оновлено ${new Date().toLocaleTimeString()}`
    list.replaceChildren(
      ...e.detail.map((r) => {
        const li = document.createElement('li')
        const btn = document.createElement('button')
        btn.textContent = 'Join'
        btn.disabled = r.players >= r.max
        // стрілка: this всередині lobby.join лишається lobby
        btn.addEventListener('click', () => lobby.join(r.id, nameInput.value))
        li.append(`${r.name} — ${r.players}/${r.max} `, btn)
        return li
      }),
    )
  }
  const onError = (e) => {
    status.textContent = `Не вдалося оновити список: ${e.detail.message}`
  }
  lobby.addEventListener('rooms', onRooms)
  lobby.addEventListener('error', onError)
  return () => {
    lobby.removeEventListener('rooms', onRooms)
    lobby.removeEventListener('error', onError)
    root.innerHTML = ''
  }
}
