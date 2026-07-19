import { createServer } from 'node:http'
import { createReadStream, existsSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Server } from 'socket.io'

const rooms = new Map()
const port = Number(process.env.PORT ?? 8787)
const projectRoot = resolve(fileURLToPath(new URL('.', import.meta.url)))
const staticRoot = resolve(projectRoot, 'dist')
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}
const availableNetworks = Object.entries(networkInterfaces()).flatMap(([name, addresses]) =>
  (addresses ?? []).map((network) => ({ name, network })),
)
const localAddress = (availableNetworks.find(({ name, network }) =>
  /wi-?fi|wlan|ethernet/i.test(name) && network.family === 'IPv4' && !network.internal,
) ?? availableNetworks.find(({ network }) => network.family === 'IPv4' && !network.internal))?.network.address
const clientUrl = process.env.CLIENT_URL ?? process.env.RENDER_EXTERNAL_URL ?? `http://${localAddress ?? '127.0.0.1'}:4173`

const httpServer = createServer(async (request, response) => {
  if (request.method === 'POST' && request.url === '/api/transcribe') {
    let rawBody = ''
    for await (const chunk of request) {
      rawBody += chunk
      if (rawBody.length > 15_000_000) throw new Error('Audio payload is too large')
    }
    try {
      if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured')
      const { roomCode, clientId, audioBase64, mimeType = 'audio/webm' } = JSON.parse(rawBody)
      const room = rooms.get(String(roomCode).toUpperCase())
      const player = room?.players.get(clientId)
      if (!room || !player || room.phase !== 'day' || !player.alive) throw new Error('当前不能记录发言')
      const binary = Buffer.from(String(audioBase64), 'base64')
      if (!binary.length) throw new Error('没有收到音频')
      const form = new FormData()
      form.set('model', 'gpt-4o-mini-transcribe')
      form.set('language', 'zh')
      const extension = mimeType.includes('wav') ? 'wav' : 'webm'
      form.set('file', new Blob([binary], { type: mimeType }), `speech.${extension}`)
      const transcription = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: form,
      })
      if (!transcription.ok) {
        const detail = await transcription.text()
        throw new Error(`Transcription request failed: ${transcription.status} ${detail}`)
      }
      const result = await transcription.json()
      const text = String(result.text ?? '').trim()
      if (text) {
        event(room, `${player.seat} 号发言：${text}`)
        broadcast(room)
      }
      send(response, 200, { text })
    } catch (error) {
      send(response, 500, { error: error instanceof Error ? error.message : 'Unable to transcribe speech' })
    }
    return
  }

  if (request.method === 'POST' && request.url === '/api/recap') {
    let rawBody = ''
    for await (const chunk of request) rawBody += chunk
    try {
      if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured')
      const { events = [] } = JSON.parse(rawBody)
      const completion = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: '你是狼人杀离席补课助手。只总结输入的公开事件，绝不推测身份或夜晚行动。绝不改变游戏状态词：出局必须保留为出局。只输出合法 JSON：{"recap":[{"time":"HH:MM","text":"..."}]}。' },
            { role: 'user', content: JSON.stringify({ events }) },
          ],
        }),
      })
      if (!completion.ok) throw new Error(`OpenAI request failed: ${completion.status}`)
      const result = await completion.json()
      const payload = JSON.parse(result.choices?.[0]?.message?.content)
      send(response, 200, { recap: Array.isArray(payload.recap) ? payload.recap.slice(0, 4) : [] })
    } catch (error) {
      send(response, 500, { error: error instanceof Error ? error.message : 'Unable to build recap' })
    }
    return
  }
  serveStatic(request, response)
})

const io = new Server(httpServer, { cors: { origin: true } })

function send(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(payload))
}

function serveStatic(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    send(response, 404, { error: 'Not found' })
    return
  }
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
  if (pathname.startsWith('/socket.io/')) return
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const requestedFile = resolve(staticRoot, relativePath)
  const canServeRequestedFile = requestedFile === staticRoot || requestedFile.startsWith(`${staticRoot}${sep}`)
  const file = canServeRequestedFile && existsSync(requestedFile) ? requestedFile : resolve(staticRoot, 'index.html')
  if (!existsSync(file)) {
    send(response, 503, { error: 'Web client has not been built yet' })
    return
  }
  response.writeHead(200, { 'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream' })
  if (request.method === 'HEAD') return response.end()
  createReadStream(file).pipe(response)
}

function roomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  do code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  while (rooms.has(code))
  return code
}

function rolesFor(count) {
  const core = count >= 7
    ? ['狼人', '狼人', '狼人', '预言家', '女巫', '村民', '村民', '村民', '村民']
    : ['狼人', '预言家', '女巫', '村民', '村民', '村民']
  return core.slice(0, count).sort(() => Math.random() - 0.5)
}

function event(room, text) {
  room.events.unshift({ time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }), text })
  room.events = room.events.slice(0, 30)
}

function publicRoom(room) {
  const tally = room.votesRevealed ? Object.entries(room.votes).reduce((sum, [, seat]) => {
    sum[seat] = (sum[seat] ?? 0) + 1
    return sum
  }, {}) : null
  return {
    code: room.code,
    joinUrl: `${clientUrl}/?room=${room.code}`,
    phase: room.phase,
    day: room.day,
    players: [...room.players.values()]
      .map((player) => ({ name: player.name, seat: player.seat, alive: player.alive, ready: player.ready }))
      .sort((a, b) => a.seat - b.seat),
    nightDoneCount: [...room.players.values()].filter((player) => player.nightDone).length,
    events: room.events,
    votesRevealed: room.votesRevealed,
    tally,
    winner: room.winner,
  }
}

function privatePlayer(room, clientId) {
  const player = room.players.get(clientId)
  if (!player) return null
  const wolfTeam = player.role === '狼人'
    ? [...room.players.values()].filter((item) => item.role === '狼人').map((item) => ({ seat: item.seat, name: item.name }))
    : []
  const witchTarget = player.role === '女巫' ? room.night.wolfTarget : null
  return {
    seat: player.seat,
    role: player.role,
    alive: player.alive,
    ready: player.ready,
    nightDone: player.nightDone,
    nightResult: player.nightResult,
    wolfTeam,
    witchTarget,
    hasVoted: Boolean(room.votes[clientId]),
    isHost: room.hostId === clientId,
  }
}

function broadcast(room) {
  for (const player of room.players.values()) {
    for (const socketId of player.sockets) {
      io.to(socketId).emit('room-state', { room: publicRoom(room), me: privatePlayer(room, player.clientId) })
    }
  }
}

function checkWinner(room) {
  const alive = [...room.players.values()].filter((player) => player.alive)
  const wolves = alive.filter((player) => player.role === '狼人').length
  const villagers = alive.length - wolves
  if (wolves === 0) room.winner = '好人阵营获胜'
  if (wolves > 0 && wolves >= villagers) room.winner = '狼人阵营获胜'
  if (room.winner) {
    room.phase = 'ended'
    event(room, room.winner)
  }
}

function resolveNight(room) {
  const deaths = new Set()
  if (room.night.wolfTarget && !room.night.witchSave) deaths.add(room.night.wolfTarget)
  if (room.night.witchPoison) deaths.add(room.night.witchPoison)
  for (const seat of deaths) {
    const target = [...room.players.values()].find((player) => player.seat === seat)
    if (target?.alive) target.alive = false
  }
  room.day += 1
  room.phase = 'day'
  const names = [...deaths].map((seat) => `${seat} 号`).join('、')
  event(room, names ? `天亮，${names} 出局。` : '天亮，昨夜是平安夜。')
  room.night = { wolfTarget: null, witchSave: false, witchPoison: null }
  for (const player of room.players.values()) {
    player.nightDone = false
    player.nightResult = null
  }
  checkWinner(room)
}

function resolveVote(room) {
  const tally = Object.entries(room.votes).reduce((sum, [, seat]) => {
    sum[seat] = (sum[seat] ?? 0) + 1
    return sum
  }, {})
  const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1])
  room.votesRevealed = true
  if (ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1])) {
    const target = [...room.players.values()].find((player) => player.seat === Number(ranked[0][0]))
    if (target?.alive) {
      target.alive = false
      event(room, `投票结算：${target.seat} 号出局，共 ${ranked[0][1]} 票。`)
    }
  } else {
    event(room, '投票结算：平票，没有玩家出局。')
  }
  checkWinner(room)
  if (!room.winner) {
    room.phase = 'night'
    room.votes = {}
    room.votesRevealed = false
    event(room, `进入第 ${room.day + 1} 夜。`)
  }
}

function guardHost(room, clientId) {
  if (room.hostId !== clientId) throw new Error('只有创建房间的设备可以推进流程')
}

io.on('connection', (socket) => {
  socket.on('create-room', ({ clientId, name }, reply) => {
    const code = roomCode()
    const room = {
      code,
      hostId: clientId,
      phase: 'lobby',
      day: 0,
      players: new Map(),
      events: [],
      votes: {},
      votesRevealed: false,
      winner: null,
      night: { wolfTarget: null, witchSave: false, witchPoison: null },
    }
    rooms.set(code, room)
    const player = joinRoom(socket, room, { clientId, name })
    event(room, `${player.seat} 号 ${player.name} 创建了房间。`)
    broadcast(room)
    reply({ ok: true, code, seat: player.seat })
  })

  socket.on('join-room', ({ code, clientId, name }, reply) => {
    const room = rooms.get(String(code).toUpperCase())
    if (!room) return reply({ ok: false, error: '没找到这个房间号' })
    if (room.phase !== 'lobby' && !room.players.has(clientId)) return reply({ ok: false, error: '游戏已经开始，暂时不能加入' })
    try {
      const player = joinRoom(socket, room, { clientId, name })
      event(room, `${player.seat} 号 ${player.name} 加入了房间。`)
      broadcast(room)
      reply({ ok: true, code: room.code, seat: player.seat })
    } catch (error) {
      reply({ ok: false, error: error instanceof Error ? error.message : '加入失败' })
    }
  })

  socket.on('set-ready', ({ code, clientId, ready }, reply) => {
    const room = rooms.get(code)
    const player = room?.players.get(clientId)
    if (!player || room.phase !== 'lobby') return reply?.({ ok: false })
    player.ready = Boolean(ready)
    broadcast(room)
    reply?.({ ok: true })
  })

  socket.on('start-game', ({ code, clientId }, reply) => {
    const room = rooms.get(code)
    try {
      guardHost(room, clientId)
      const players = [...room.players.values()].sort((a, b) => a.seat - b.seat)
      if (players.length < 3) throw new Error('至少需要 3 名玩家')
      const roles = rolesFor(players.length)
      players.forEach((player, index) => { player.role = roles[index]; player.alive = true; player.nightDone = false })
      room.phase = 'night'
      room.day = 0
      event(room, `游戏开始，${players.length} 名玩家已收到私密身份。进入第 1 夜。`)
      broadcast(room)
      reply({ ok: true })
    } catch (error) { reply({ ok: false, error: error instanceof Error ? error.message : '无法开始' }) }
  })

  socket.on('advance-phase', ({ code, clientId }, reply) => {
    const room = rooms.get(code)
    try {
      guardHost(room, clientId)
      if (room.phase === 'night') resolveNight(room)
      else if (room.phase === 'day') { room.phase = 'vote'; room.votes = {}; room.votesRevealed = false; event(room, '发言结束，请所有存活玩家投票。') }
      else if (room.phase === 'vote') resolveVote(room)
      broadcast(room)
      reply({ ok: true })
    } catch (error) { reply({ ok: false, error: error instanceof Error ? error.message : '无法推进' }) }
  })

  socket.on('night-action', ({ code, clientId, action }, reply) => {
    const room = rooms.get(code)
    const player = room?.players.get(clientId)
    try {
      if (!room || !player || room.phase !== 'night' || !player.alive) throw new Error('当前不能进行夜晚行动')
      const target = Number(action.target)
      const targetPlayer = [...room.players.values()].find((item) => item.seat === target && item.alive)
      if (player.role === '狼人' && targetPlayer) room.night.wolfTarget = target
      if (player.role === '预言家' && targetPlayer) player.nightResult = `${target} 号是${targetPlayer.role === '狼人' ? '狼人' : '好人'}。`
      if (player.role === '女巫') {
        room.night.witchSave = Boolean(action.save) && room.night.wolfTarget !== null
        room.night.witchPoison = action.poison ? Number(action.poison) : null
      }
      player.nightDone = true
      broadcast(room)
      reply({ ok: true, result: player.nightResult })
    } catch (error) { reply({ ok: false, error: error instanceof Error ? error.message : '行动失败' }) }
  })

  socket.on('vote', ({ code, clientId, target }, reply) => {
    const room = rooms.get(code)
    const player = room?.players.get(clientId)
    if (!room || !player || room.phase !== 'vote' || !player.alive) return reply({ ok: false, error: '当前不能投票' })
    const targetPlayer = [...room.players.values()].find((item) => item.seat === Number(target) && item.alive)
    if (!targetPlayer) return reply({ ok: false, error: '请选择存活玩家' })
    room.votes[clientId] = Number(target)
    broadcast(room)
    reply({ ok: true })
  })

  socket.on('disconnect', () => {
    for (const room of rooms.values()) {
      for (const player of room.players.values()) player.sockets.delete(socket.id)
    }
  })
})

function joinRoom(socket, room, { clientId, name }) {
  const existing = room.players.get(clientId)
  const occupiedSeats = new Set([...room.players.values()].map((player) => player.seat))
  const availableSeat = Array.from({ length: 9 }, (_, index) => index + 1).find((seat) => !occupiedSeats.has(seat))
  if (!existing && !availableSeat) throw new Error('房间已满，9 个座位都已入座')
  const player = existing ?? { clientId, name: String(name).slice(0, 12) || '玩家', seat: availableSeat, alive: true, ready: false, role: null, nightDone: false, nightResult: null, sockets: new Set() }
  if (existing && room.phase === 'lobby') player.name = String(name).slice(0, 12) || player.name
  player.sockets.add(socket.id)
  room.players.set(clientId, player)
  socket.join(room.code)
  return player
}

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`AnHao game server: ${clientUrl} (port ${port})`)
})
