import { createServer } from 'node:http'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Server } from 'socket.io'

const rooms = new Map()
const port = Number(process.env.PORT ?? 8787)
const projectRoot = resolve(fileURLToPath(new URL('.', import.meta.url)))
const staticRoot = resolve(projectRoot, 'dist')
const dataDirectory = resolve(process.env.DATA_DIR ?? projectRoot, '.data')
const roomStore = resolve(dataDirectory, 'rooms.json')
const contentTypes = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp',
}
const availableNetworks = Object.entries(networkInterfaces()).flatMap(([name, addresses]) =>
  (addresses ?? []).map((network) => ({ name, network })),
)
const localAddress = (availableNetworks.find(({ name, network }) =>
  /wi-?fi|wlan|ethernet/i.test(name) && network.family === 'IPv4' && !network.internal,
) ?? availableNetworks.find(({ network }) => network.family === 'IPv4' && !network.internal))?.network.address
const clientUrl = process.env.CLIENT_URL ?? process.env.RENDER_EXTERNAL_URL ?? `http://${localAddress ?? '127.0.0.1'}:4173`
let persistQueue = Promise.resolve()

const httpServer = createServer(async (request, response) => {
  if (request.method === 'POST' && request.url === '/api/transcribe') return transcribe(request, response)
  if (request.method === 'POST' && request.url === '/api/note') return addNote(request, response)
  if (request.method === 'POST' && request.url === '/api/recap') return recap(request, response)
  serveStatic(request, response)
})
const io = new Server(httpServer, { cors: { origin: true } })

function send(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(payload))
}

async function readBody(request, limit = 15_000_000) {
  let rawBody = ''
  for await (const chunk of request) {
    rawBody += chunk
    if (rawBody.length > limit) throw new Error('请求内容过大')
  }
  return JSON.parse(rawBody)
}

async function transcribe(request, response) {
  try {
    if (!process.env.OPENAI_API_KEY) throw new Error('语音识别尚未配置 API Key')
    const { roomCode, clientId, audioBase64, mimeType = 'audio/webm' } = await readBody(request)
    const room = rooms.get(String(roomCode).toUpperCase())
    const player = room?.players.get(clientId)
    if (!room || !player || room.phase !== 'day' || !player.alive) throw new Error('当前不能记录发言')
    if (room.speakerSeat && room.speakerSeat !== player.seat) throw new Error(`当前轮到 ${room.speakerSeat} 号发言`)
    const binary = Buffer.from(String(audioBase64), 'base64')
    if (!binary.length) throw new Error('没有收到音频')
    const form = new FormData()
    form.set('model', 'gpt-4o-mini-transcribe')
    form.set('language', 'zh')
    const extension = mimeType.includes('wav') ? 'wav' : 'webm'
    form.set('file', new Blob([binary], { type: mimeType }), `speech.${extension}`)
    const transcription = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form,
    })
    if (!transcription.ok) throw new Error(`语音识别请求失败 (${transcription.status})`)
    const result = await transcription.json()
    const text = String(result.text ?? '').trim()
    if (text) {
      event(room, `${player.seat} 号发言：${text}`)
      touch(room)
      broadcast(room)
    }
    send(response, 200, { text })
  } catch (error) {
    send(response, 400, { error: error instanceof Error ? error.message : '无法转写语音' })
  }
}

async function addNote(request, response) {
  try {
    const { roomCode, clientId, text } = await readBody(request, 30_000)
    const room = rooms.get(String(roomCode).toUpperCase())
    const player = room?.players.get(clientId)
    const note = String(text ?? '').trim().slice(0, 500)
    if (!room || !player || room.phase !== 'day' || !player.alive) throw new Error('当前不能记录发言')
    if (room.speakerSeat && room.speakerSeat !== player.seat) throw new Error(`当前轮到 ${room.speakerSeat} 号发言`)
    if (!note) throw new Error('请先输入发言内容')
    event(room, `${player.seat} 号发言：${note}`)
    touch(room)
    broadcast(room)
    send(response, 200, { ok: true })
  } catch (error) { send(response, 400, { error: error instanceof Error ? error.message : '无法记录发言' }) }
}

async function recap(request, response) {
  try {
    if (!process.env.OPENAI_API_KEY) throw new Error('AI 补课尚未配置 API Key')
    const { events = [] } = await readBody(request, 300_000)
    const publicEvents = Array.isArray(events) ? events.slice(0, 8).map((item) => ({
      time: String(item.time ?? ''), text: String(item.text ?? '').slice(0, 500),
    })) : []
    const completion = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini', temperature: 0.1, response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '你是狼人杀离席补课助手。只总结输入的公开事件，绝不推测身份、夜晚行动或未公开投票。重点必须覆盖最近发生的公开发言、出局、投票或阶段变化；不要用开局和进房信息占满结果。按时间从早到晚给出不超过四条要点。只输出合法 JSON：{"recap":[{"time":"HH:MM","text":"..."}]}' },
          { role: 'user', content: JSON.stringify({ events: publicEvents.reverse() }) },
        ],
      }),
    })
    if (!completion.ok) throw new Error(`AI 补课请求失败 (${completion.status})`)
    const result = await completion.json()
    const payload = JSON.parse(result.choices?.[0]?.message?.content ?? '{}')
    send(response, 200, { recap: Array.isArray(payload.recap) ? payload.recap.slice(0, 4) : [] })
  } catch (error) {
    send(response, 400, { error: error instanceof Error ? error.message : '无法生成补课' })
  }
}

function serveStatic(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return send(response, 404, { error: 'Not found' })
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
  if (pathname.startsWith('/socket.io/')) return
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const requestedFile = resolve(staticRoot, relativePath)
  const isSafePath = requestedFile === staticRoot || requestedFile.startsWith(`${staticRoot}${sep}`)
  const file = isSafePath && existsSync(requestedFile) ? requestedFile : resolve(staticRoot, 'index.html')
  if (!existsSync(file)) return send(response, 503, { error: 'Web client has not been built yet' })
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
  const recipes = {
    3: ['狼人', '预言家', '女巫'],
    4: ['狼人', '预言家', '女巫', '村民'],
    5: ['狼人', '预言家', '女巫', '村民', '村民'],
    6: ['狼人', '狼人', '预言家', '女巫', '村民', '村民'],
    7: ['狼人', '狼人', '预言家', '女巫', '村民', '村民', '村民'],
    8: ['狼人', '狼人', '预言家', '女巫', '村民', '村民', '村民', '村民'],
    9: ['狼人', '狼人', '狼人', '预言家', '女巫', '村民', '村民', '村民', '村民'],
  }
  return [...recipes[count]].sort(() => Math.random() - 0.5)
}

function now() { return new Date().toISOString() }
function event(room, text) {
  room.events.unshift({ time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }), text })
  room.events = room.events.slice(0, 80)
}
function touch(room) { room.updatedAt = now(); persistRooms() }
function living(room) { return [...room.players.values()].filter((player) => player.alive) }
function nextLivingSeat(room, afterSeat) {
  const seats = living(room).map((player) => player.seat).sort((a, b) => a - b)
  if (!seats.length) return null
  if (!afterSeat) return seats[0]
  return seats.find((seat) => seat > afterSeat) ?? null
}
function allAliveCompleted(room, key) { return living(room).every((player) => Boolean(player[key])) }

function publicRoom(room) {
  const tally = room.votesRevealed ? Object.entries(room.votes).reduce((sum, [, seat]) => {
    sum[seat] = (sum[seat] ?? 0) + 1
    return sum
  }, {}) : null
  const currentSpeaker = room.speakerSeat ? room.players.get(room.seatIndex[room.speakerSeat]) : null
  return {
    code: room.code, joinUrl: `${clientUrl}/?room=${room.code}`, phase: room.phase, day: room.day, gameMode: room.gameMode,
    players: [...room.players.values()].map((player) => ({
      name: player.name, seat: player.seat, alive: player.alive, ready: player.ready, online: player.sockets.size > 0,
    })).sort((a, b) => a.seat - b.seat),
    events: room.events, winner: room.winner, votesRevealed: room.votesRevealed, tally,
    nightDoneCount: living(room).filter((player) => player.nightDone).length,
    voteCount: Object.keys(room.votes).length,
    speakerSeat: room.speakerSeat,
    speakerName: currentSpeaker?.name ?? null,
  }
}

function privatePlayer(room, clientId) {
  const player = room.players.get(clientId)
  if (!player) return null
  const wolfTeam = player.role === '狼人' ? [...room.players.values()].filter((item) => item.role === '狼人').map((item) => ({ seat: item.seat, name: item.name })) : []
  return {
    seat: player.seat, role: player.role, alive: player.alive, ready: player.ready, nightDone: player.nightDone,
    nightResult: player.nightResult, wolfTeam, witchTarget: player.role === '女巫' ? room.night.wolfTarget : null,
    hasAntidote: player.hasAntidote, hasPoison: player.hasPoison, hasVoted: Boolean(room.votes[clientId]),
    isHost: room.hostId === clientId,
  }
}

function broadcast(room) {
  for (const player of room.players.values()) {
    for (const socketId of player.sockets) io.to(socketId).emit('room-state', { room: publicRoom(room), me: privatePlayer(room, player.clientId) })
  }
}

function checkWinner(room) {
  const alive = living(room)
  const wolves = alive.filter((player) => player.role === '狼人').length
  const villagers = alive.length - wolves
  if (wolves === 0) room.winner = '好人阵营获胜'
  if (wolves > 0 && wolves >= villagers) room.winner = '狼人阵营获胜'
  if (room.winner) {
    room.phase = 'ended'
    room.speakerSeat = null
    event(room, room.winner)
  }
}

function resetNight(room) {
  room.night = { wolfTarget: null, witchSave: false, witchPoison: null }
  for (const player of room.players.values()) {
    player.nightDone = false
    player.nightResult = null
  }
}

function resolveNight(room) {
  const deaths = new Set()
  if (room.night.wolfTarget && !room.night.witchSave) deaths.add(room.night.wolfTarget)
  if (room.night.witchPoison) deaths.add(room.night.witchPoison)
  for (const seat of deaths) {
    const target = room.players.get(room.seatIndex[seat])
    if (target?.alive) target.alive = false
  }
  room.day += 1
  room.phase = 'day'
  room.speakerSeat = nextLivingSeat(room, null)
  const names = [...deaths].map((seat) => `${seat} 号`).join('、')
  event(room, names ? `天亮，${names} 出局。` : '天亮，昨夜是平安夜。')
  if (room.speakerSeat) event(room, `白天讨论开始，轮到 ${room.speakerSeat} 号发言。`)
  resetNight(room)
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
    const target = room.players.get(room.seatIndex[Number(ranked[0][0])])
    if (target?.alive) {
      target.alive = false
      event(room, `投票结算：${target.seat} 号出局，共 ${ranked[0][1]} 票。`)
    }
  } else event(room, '投票结算：平票，没有玩家出局。')
  checkWinner(room)
  if (!room.winner) {
    room.phase = 'night'
    room.votes = {}
    room.votesRevealed = false
    room.speakerSeat = null
    resetNight(room)
    event(room, `进入第 ${room.day + 1} 夜。`)
  }
}

function guardRoom(room) { if (!room) throw new Error('房间已不存在，请重新加入') }
function guardHost(room, clientId) { guardRoom(room); if (room.hostId !== clientId) throw new Error('只有主持设备可以推进流程') }
function normalizeName(value) { return String(value ?? '').trim().slice(0, 12) || '玩家' }

io.on('connection', (socket) => {
  socket.on('create-room', ({ clientId, name, gameMode }, reply) => {
    const code = roomCode()
    const room = {
      code, hostId: clientId, phase: 'lobby', day: 0, gameMode: gameMode === 'online' ? 'online' : 'offline', players: new Map(), seatIndex: {}, events: [], votes: {},
      votesRevealed: false, winner: null, speakerSeat: null, night: { wolfTarget: null, witchSave: false, witchPoison: null },
      createdAt: now(), updatedAt: now(),
    }
    rooms.set(code, room)
    const player = joinRoom(socket, room, { clientId, name })
    event(room, `${player.seat} 号 ${player.name} 创建了房间。`)
    touch(room)
    broadcast(room)
    reply({ ok: true, code, seat: player.seat })
  })

  socket.on('join-room', ({ code, clientId, name }, reply) => {
    const room = rooms.get(String(code).toUpperCase())
    if (!room) return reply({ ok: false, error: '没找到这个房间号' })
    if (room.phase !== 'lobby' && !room.players.has(clientId)) return reply({ ok: false, error: '游戏已经开始，暂时不能加入' })
    try {
      const existing = room.players.has(clientId)
      const player = joinRoom(socket, room, { clientId, name })
      if (!existing) event(room, `${player.seat} 号 ${player.name} 加入了房间。`)
      else event(room, `${player.seat} 号 ${player.name} 已回到房间。`)
      touch(room)
      broadcast(room)
      reply({ ok: true, code: room.code, seat: player.seat })
    } catch (error) { reply({ ok: false, error: error instanceof Error ? error.message : '加入失败' }) }
  })

  socket.on('resume-room', ({ code, clientId }, reply) => {
    const room = rooms.get(String(code).toUpperCase())
    const player = room?.players.get(clientId)
    if (!room || !player) return reply({ ok: false, error: '该设备没有这个房间的座位' })
    player.sockets.add(socket.id)
    socket.join(room.code)
    touch(room)
    broadcast(room)
    reply({ ok: true, code: room.code, seat: player.seat })
  })

  socket.on('leave-room', ({ code, clientId }, reply) => {
    const room = rooms.get(String(code).toUpperCase())
    const player = room?.players.get(clientId)
    if (!room || !player || room.phase !== 'lobby') return reply({ ok: false, error: '游戏开始后请保留座位，重连即可返回' })
    room.players.delete(clientId)
    delete room.seatIndex[player.seat]
    if (room.hostId === clientId) room.hostId = [...room.players.keys()][0] ?? null
    event(room, `${player.seat} 号 ${player.name} 离开了等候房。`)
    if (!room.players.size) rooms.delete(room.code)
    else { touch(room); broadcast(room) }
    reply({ ok: true })
  })

  socket.on('set-ready', ({ code, clientId, ready }, reply) => {
    const room = rooms.get(String(code).toUpperCase())
    const player = room?.players.get(clientId)
    if (!player || room.phase !== 'lobby') return reply?.({ ok: false, error: '当前不能准备' })
    player.ready = Boolean(ready)
    touch(room)
    broadcast(room)
    reply?.({ ok: true })
  })

  socket.on('start-game', ({ code, clientId }, reply) => {
    const room = rooms.get(String(code).toUpperCase())
    try {
      guardHost(room, clientId)
      const players = [...room.players.values()].sort((a, b) => a.seat - b.seat)
      if (players.length < 3 || players.length > 9) throw new Error('需要 3 至 9 名玩家才能开始')
      if (!players.every((player) => player.ready)) throw new Error('请等待所有入座玩家准备')
      const roles = rolesFor(players.length)
      players.forEach((player, index) => {
        player.role = roles[index]; player.alive = true; player.nightDone = false; player.nightResult = null
        player.hasAntidote = player.role === '女巫'; player.hasPoison = player.role === '女巫'
      })
      room.phase = 'night'; room.day = 0; room.winner = null; room.votes = {}; room.votesRevealed = false; room.speakerSeat = null
      resetNight(room)
      event(room, `游戏开始，${players.length} 名玩家已收到私密身份。进入第 1 夜。`)
      touch(room)
      broadcast(room)
      reply({ ok: true })
    } catch (error) { reply({ ok: false, error: error instanceof Error ? error.message : '无法开始' }) }
  })

  socket.on('advance-phase', ({ code, clientId }, reply) => {
    const room = rooms.get(String(code).toUpperCase())
    try {
      guardHost(room, clientId)
      if (room.phase === 'night') {
        if (!allAliveCompleted(room, 'nightDone')) throw new Error(`还有 ${living(room).filter((player) => !player.nightDone).length} 位存活玩家未完成夜晚行动`)
        resolveNight(room)
      } else if (room.phase === 'day') {
        room.phase = 'vote'; room.votes = {}; room.votesRevealed = false; room.speakerSeat = null
        event(room, '发言结束，请所有存活玩家投票。')
      } else if (room.phase === 'vote') {
        if (Object.keys(room.votes).length !== living(room).length) throw new Error('请等待所有存活玩家完成投票')
        resolveVote(room)
      } else throw new Error('当前阶段无需推进')
      touch(room)
      broadcast(room)
      reply({ ok: true })
    } catch (error) { reply({ ok: false, error: error instanceof Error ? error.message : '无法推进' }) }
  })

  socket.on('next-speaker', ({ code, clientId }, reply) => {
    const room = rooms.get(String(code).toUpperCase())
    try {
      guardHost(room, clientId)
      if (room.phase !== 'day') throw new Error('当前不是发言阶段')
      const nextSeat = nextLivingSeat(room, room.speakerSeat)
      room.speakerSeat = nextSeat
      event(room, nextSeat ? `轮到 ${nextSeat} 号发言。` : '本轮所有存活玩家已依次发言。')
      touch(room)
      broadcast(room)
      reply({ ok: true, speakerSeat: nextSeat })
    } catch (error) { reply({ ok: false, error: error instanceof Error ? error.message : '无法切换发言人' }) }
  })

  socket.on('night-action', ({ code, clientId, action = {} }, reply) => {
    const room = rooms.get(String(code).toUpperCase())
    const player = room?.players.get(clientId)
    try {
      guardRoom(room)
      if (!player || room.phase !== 'night' || !player.alive) throw new Error('当前不能进行夜晚行动')
      if (player.nightDone) throw new Error('夜晚行动已经提交')
      const target = Number(action.target)
      const targetPlayer = room.players.get(room.seatIndex[target])
      if (player.role === '狼人') {
        if (!targetPlayer?.alive || targetPlayer.role === '狼人') throw new Error('狼人只能选择一名存活的非狼玩家')
        room.night.wolfTarget = target
      } else if (player.role === '预言家') {
        if (!targetPlayer?.alive || target === player.seat) throw new Error('请选择另一名存活玩家查验')
        player.nightResult = `${target} 号是${targetPlayer.role === '狼人' ? '狼人' : '好人'}。`
      } else if (player.role === '女巫') {
        if (action.save) {
          if (!player.hasAntidote || !room.night.wolfTarget) throw new Error('当前没有可使用的解药目标')
          room.night.witchSave = true
          player.hasAntidote = false
        } else if (action.poison) {
          if (!player.hasPoison || !targetPlayer?.alive || target === player.seat) throw new Error('请选择另一名存活玩家使用毒药')
          room.night.witchPoison = target
          player.hasPoison = false
        }
      }
      player.nightDone = true
      touch(room)
      broadcast(room)
      reply({ ok: true, result: player.nightResult })
    } catch (error) { reply({ ok: false, error: error instanceof Error ? error.message : '行动失败' }) }
  })

  socket.on('vote', ({ code, clientId, target }, reply) => {
    const room = rooms.get(String(code).toUpperCase())
    const player = room?.players.get(clientId)
    const targetPlayer = room?.players.get(room?.seatIndex[Number(target)])
    if (!room || !player || room.phase !== 'vote' || !player.alive) return reply({ ok: false, error: '当前不能投票' })
    if (!targetPlayer?.alive) return reply({ ok: false, error: '请选择存活玩家' })
    room.votes[clientId] = Number(target)
    touch(room)
    broadcast(room)
    reply({ ok: true })
  })

  socket.on('disconnect', () => {
    for (const room of rooms.values()) {
      for (const player of room.players.values()) player.sockets.delete(socket.id)
      touch(room)
      broadcast(room)
    }
  })
})

function joinRoom(socket, room, { clientId, name }) {
  const existing = room.players.get(clientId)
  const occupiedSeats = new Set([...room.players.values()].map((player) => player.seat))
  const availableSeat = Array.from({ length: 9 }, (_, index) => index + 1).find((seat) => !occupiedSeats.has(seat))
  if (!existing && !availableSeat) throw new Error('房间已满，9 个座位都已入座')
  const player = existing ?? {
    clientId, name: normalizeName(name), seat: availableSeat, alive: true, ready: false, role: null, nightDone: false,
    nightResult: null, hasAntidote: false, hasPoison: false, sockets: new Set(),
  }
  if (existing && room.phase === 'lobby') player.name = normalizeName(name)
  player.sockets.add(socket.id)
  room.players.set(clientId, player)
  room.seatIndex[player.seat] = clientId
  socket.join(room.code)
  return player
}

function serializableRooms() {
  return [...rooms.values()].map((room) => ({
    ...room,
    players: [...room.players.values()].map(({ sockets: _sockets, ...player }) => player),
  }))
}
function persistRooms() {
  persistQueue = persistQueue.then(async () => {
    await mkdir(dataDirectory, { recursive: true })
    const temporary = `${roomStore}.tmp`
    await writeFile(temporary, JSON.stringify(serializableRooms()), 'utf8')
    await rename(temporary, roomStore)
  }).catch((error) => console.error('Unable to persist rooms:', error.message))
}
async function loadRooms() {
  try {
    const raw = JSON.parse(await readFile(roomStore, 'utf8'))
    for (const saved of Array.isArray(raw) ? raw : []) {
      if (!saved?.code || !Array.isArray(saved.players)) continue
      const players = new Map(saved.players.map((player) => [player.clientId, { ...player, sockets: new Set() }]))
      rooms.set(saved.code, { ...saved, players, seatIndex: saved.seatIndex ?? Object.fromEntries([...players.values()].map((player) => [player.seat, player.clientId])) })
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') console.error('Unable to load rooms:', error.message)
  }
}
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  for (const [code, room] of rooms) if (Date.parse(room.updatedAt ?? 0) < cutoff) rooms.delete(code)
  persistRooms()
}, 10 * 60 * 1000).unref()

await loadRooms()
httpServer.listen(port, '0.0.0.0', () => console.log(`AnHao game server: ${clientUrl} (port ${port})`))
