import type { Lobby, RoomInfo } from './lobby.ts'

/** DOM-представлення лобі; мережі не торкається. */
export function mountLobbyView(root: HTMLElement, lobby: Lobby): () => void {
  root.innerHTML = `
    <div class="lobby">
      <h1>Dogfight</h1>
      <label>Ім'я <input id="name" maxlength="16" value="pilot"></label>
      <ul id="rooms"><li class="muted">Завантаження кімнат…</li></ul>
      <form id="create"><input id="newroom" placeholder="нова-кімната" maxlength="24"><button>Create</button></form>
      <p id="status" class="muted"></p>
    </div>`
  const q = <E extends Element>(sel: string): E => {
    const el = root.querySelector<E>(sel)
    if (!el) throw new Error(`missing ${sel}`)
    return el
  }
  const list = q<HTMLUListElement>('#rooms')
  const status = q<HTMLParagraphElement>('#status')
  const nameInput = q<HTMLInputElement>('#name')

  const onRooms = (rooms: RoomInfo[]): void => {
    status.textContent = `Оновлено ${new Date().toLocaleTimeString()}`
    list.replaceChildren(
      ...rooms.map((r) => {
        const li = document.createElement('li')
        const btn = document.createElement('button')
        btn.textContent = 'Join'
        btn.disabled = r.players >= r.max
        btn.addEventListener('click', () => lobby.join(r.id, nameInput.value))
        li.append(`${r.name} — ${r.players}/${r.max} `, btn)
        return li
      }),
    )
  }
  const onError = (err: unknown): void => {
    status.textContent = `Не вдалося оновити список: ${err instanceof Error ? err.message : String(err)}`
  }
  q<HTMLFormElement>('#create').addEventListener('submit', (e) => {
    e.preventDefault()
    const id = q<HTMLInputElement>('#newroom').value.trim().toLowerCase()
    void lobby
      .create(id)
      .then(
        (ok) =>
          (status.textContent = ok
            ? `Кімнату ${id} створено`
            : 'Не вдалося створити кімнату'),
      )
  })
  const offRooms = lobby.on('rooms', onRooms)
  const offError = lobby.on('error', onError)
  return () => {
    offRooms()
    offError()
    root.innerHTML = ''
  }
}
