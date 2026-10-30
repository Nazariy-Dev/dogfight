// ДЛЯ ПОРІВНЯННЯ: як НЕ треба. Віддає файл, ігноруючи результат res.write() (без backpressure).
// node scripts/naive-server.js <file> <port>
import http from 'node:http'
import { createReadStream } from 'node:fs'

const [file, port = '8099'] = process.argv.slice(2)
http
  .createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' })
    const rs = createReadStream(file)
    rs.on('data', (chunk) => res.write(chunk)) // false ігнорується — дані копляться в пам'яті
    rs.on('end', () => res.end())
  })
  .listen(Number(port), () => console.log('naive on', port))
