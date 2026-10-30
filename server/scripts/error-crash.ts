// 'error' без слухача валить процес. node scripts/error-crash.js [--fix]
import { EventEmitter } from 'node:events'

const room = new EventEmitter()
if (process.argv.includes('--fix')) {
  room.on('error', (err) => console.log('handled:', err.message, '— процес живий'))
}
setTimeout(() => console.log('tick: сервер ще працює'), 50)
room.emit('error', new Error('socket write EPIPE'))
console.log('after emit')
