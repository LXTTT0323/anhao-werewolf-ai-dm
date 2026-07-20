import { useEffect, useMemo, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import QRCode from 'qrcode'
import {
  Check, ChevronRight, ClipboardList, Copy, Crown, Eye, Info, LockKeyhole, LogOut, Mic,
  MoonStar, Play, QrCode, ShieldCheck, Sparkles, Square, Sun, UserRoundCheck, UsersRound, Vote,
} from 'lucide-react'
import './App.css'

type Player = { name: string; seat: number; alive: boolean; ready: boolean; online: boolean }
type Event = { time: string; text: string }
type Room = {
  code: string; joinUrl: string; phase: 'lobby' | 'night' | 'day' | 'vote' | 'ended'; day: number
  players: Player[]; nightDoneCount: number; events: Event[]; tally: Record<string, number> | null
  votesRevealed: boolean; winner: string | null; voteCount: number; speakerSeat: number | null; speakerName: string | null
}
type Me = {
  seat: number; role: string | null; alive: boolean; ready: boolean; nightDone: boolean
  nightResult: string | null; wolfTeam: { seat: number; name: string }[]; witchTarget: number | null
  hasVoted: boolean; hasAntidote: boolean; hasPoison: boolean; isHost: boolean
}

const phases = {
  lobby: { label: '等候入座', hint: '等待所有玩家进房并准备', icon: UsersRound },
  night: { label: '夜晚行动', hint: '私密行动进行中', icon: MoonStar },
  day: { label: '白天讨论', hint: '轮流发言与公开记录', icon: Sun },
  vote: { label: '放逐投票', hint: '请在自己的设备上投票', icon: Vote },
  ended: { label: '本局结束', hint: '可以查看完整复盘', icon: Crown },
}

const clientId = (() => {
  const device = new URLSearchParams(location.search).get('device')
  const storageKey = device ? `anHaoClientId:${device}` : 'anHaoClientId'
  const current = localStorage.getItem(storageKey)
  if (current) return current
  const next = crypto.randomUUID()
  localStorage.setItem(storageKey, next)
  return next
})()
const savedRoomKey = `anHaoRoom:${new URLSearchParams(location.search).get('device') ?? 'default'}`

const blobToBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
  reader.onerror = reject
  reader.readAsDataURL(blob)
})

function App() {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [room, setRoom] = useState<Room | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [mode, setMode] = useState<'control' | 'play'>('control')
  const [name, setName] = useState(() => localStorage.getItem('anHaoName') ?? '')
  const [roomInput, setRoomInput] = useState(() => new URLSearchParams(location.search).get('room') ?? '')
  const [qrUrl, setQrUrl] = useState('')
  const [error, setError] = useState('')
  const [recap, setRecap] = useState<Event[] | null>(null)
  const [recapLoading, setRecapLoading] = useState(false)
  const [witchMode, setWitchMode] = useState<'save' | 'poison'>('save')
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const alivePlayers = useMemo(() => room?.players.filter((player) => player.alive) ?? [], [room])

  useEffect(() => {
    const liveSocket = io({ path: '/socket.io', reconnection: true })
    liveSocket.on('room-state', ({ room: nextRoom, me: nextMe }) => {
      setRoom(nextRoom)
      setMe(nextMe)
      localStorage.setItem(savedRoomKey, nextRoom.code)
      setReconnecting(false)
      setError('')
    })
    liveSocket.on('connect', () => {
      const rememberedRoom = localStorage.getItem(savedRoomKey)
      if (!rememberedRoom) return
      setReconnecting(true)
      liveSocket.emit('resume-room', { code: rememberedRoom, clientId }, (result: { ok: boolean }) => {
        if (!result.ok) { localStorage.removeItem(savedRoomKey); setReconnecting(false) }
      })
    })
    liveSocket.on('disconnect', () => setReconnecting(true))
    setSocket(liveSocket)
    return () => { liveSocket.close() }
  }, [])

  useEffect(() => {
    if (!room?.joinUrl) return
    QRCode.toDataURL(room.joinUrl, { width: 320, margin: 1, color: { dark: '#132d32', light: '#ffffff' } }).then(setQrUrl)
  }, [room?.joinUrl])

  const emit = (event: string, payload: object) => new Promise<{ ok: boolean; error?: string }>((resolve) => {
    if (!socket?.connected) return resolve({ ok: false, error: '连接暂时中断，正在尝试恢复' })
    socket.emit(event, payload, resolve)
  })
  const rememberName = () => localStorage.setItem('anHaoName', name.trim())
  const createRoom = async () => {
    if (!name.trim()) return setError('先填一个昵称')
    rememberName()
    const result = await emit('create-room', { clientId, name: name.trim() })
    if (!result.ok) setError(result.error ?? '创建失败，请稍后再试')
  }
  const joinRoom = async () => {
    if (!name.trim() || !roomInput.trim()) return setError('请填写昵称和房间号')
    rememberName()
    const result = await emit('join-room', { clientId, name: name.trim(), code: roomInput.trim().toUpperCase() })
    if (!result.ok) setError(result.error ?? '加入失败，请检查房间号或座位')
  }
  const startGame = async () => {
    const result = await emit('start-game', { code: room?.code, clientId })
    if (!result.ok) setError(result.error ?? '暂时无法开始')
  }
  const advance = async () => {
    const result = await emit('advance-phase', { code: room?.code, clientId })
    if (!result.ok) setError(result.error ?? '暂时无法推进流程')
  }
  const nextSpeaker = async () => {
    const result = await emit('next-speaker', { code: room?.code, clientId })
    if (!result.ok) setError(result.error ?? '无法切换发言人')
  }
  const submitNight = async (action: object) => {
    const result = await emit('night-action', { code: room?.code, clientId, action })
    if (!result.ok) setError(result.error ?? '行动提交失败')
  }
  const submitVote = async (target: number) => {
    const result = await emit('vote', { code: room?.code, clientId, target })
    if (!result.ok) setError(result.error ?? '投票提交失败')
  }
  const toggleReady = async () => {
    const result = await emit('set-ready', { code: room?.code, clientId, ready: !me?.ready })
    if (!result.ok) setError(result.error ?? '准备状态更新失败')
  }
  const leaveRoom = async () => {
    if (!room || room.phase !== 'lobby') return
    const result = await emit('leave-room', { code: room.code, clientId })
    if (!result.ok) return setError(result.error ?? '暂时无法离开')
    localStorage.removeItem(savedRoomKey)
    setRoom(null)
    setMe(null)
  }
  const generateRecap = async () => {
    if (!room) return
    setRecapLoading(true)
    try {
      const response = await fetch('/api/recap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events: room.events }) })
      const data = await response.json() as { recap?: Event[] }
      setRecap(data.recap?.length ? data.recap : room.events.slice(0, 4))
    } catch { setRecap(room.events.slice(0, 4)) } finally { setRecapLoading(false) }
  }
  const recordSpeech = async () => {
    if (!room || !me) return
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop()
      setRecording(false)
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop())
        setTranscribing(true)
        try {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
          const response = await fetch('/api/transcribe', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roomCode: room.code, clientId, audioBase64: await blobToBase64(blob), mimeType: blob.type }),
          })
          const result = await response.json() as { error?: string }
          if (!response.ok) setError(result.error ?? '转写失败')
        } catch { setError('录音上传失败') } finally { setTranscribing(false); recorderRef.current = null }
      }
      recorderRef.current = recorder
      recorder.start()
      setRecording(true)
    } catch { setError('请允许浏览器使用麦克风') }
  }

  if (!room || !me) return <EntryScreen name={name} roomInput={roomInput} error={error} setName={setName} setRoomInput={setRoomInput} createRoom={createRoom} joinRoom={joinRoom} />

  const isControl = me.isHost && mode === 'control'
  return <main className="app-shell">
    <RoomHeader room={room} me={me} name={name} mode={mode} reconnecting={reconnecting} setMode={setMode} leaveRoom={leaveRoom} />
    {isControl
      ? <ControlDesk room={room} alivePlayers={alivePlayers} qrUrl={qrUrl} error={error} startGame={startGame} advance={advance} nextSpeaker={nextSpeaker} />
      : <PlayerDesk room={room} me={me} alivePlayers={alivePlayers} error={error} witchMode={witchMode} setWitchMode={setWitchMode} submitNight={submitNight} submitVote={submitVote} toggleReady={toggleReady} recordSpeech={recordSpeech} recording={recording} transcribing={transcribing} generateRecap={generateRecap} recap={recap} recapLoading={recapLoading} />}
  </main>
}

function EntryScreen({ name, roomInput, error, setName, setRoomInput, createRoom, joinRoom }: {
  name: string; roomInput: string; error: string
  setName: (value: string) => void; setRoomInput: (value: string) => void
  createRoom: () => void; joinRoom: () => void
}) {
  return <main className="entry-page">
    <header className="site-header">
      <div className="brand"><span>W</span><strong>暗号</strong><i>狼人杀 AI 上帝</i></div>
      <div className="header-note"><span className="online-dot" />实时房间已就绪</div>
    </header>
    <section className="entry-content">
      <div className="entry-copy">
        <p className="eyebrow">一局游戏，一套同步的手机体验</p>
        <h1>让每个人都能<br />好好玩这局狼人杀。</h1>
        <p className="lead">扫码进房、私密身份、夜晚行动、发言记录和离席补课都在同一间房里。AI 负责流程，人负责判断。</p>
        <div className="feature-list">
          <span><ShieldCheck size={18} />身份和夜晚信息仅本人可见</span>
          <span><Mic size={18} />发言转写为可回看的公开记录</span>
          <span><Sparkles size={18} />随时生成错过内容的 AI 补课</span>
        </div>
      </div>
      <section className="entry-card" aria-label="进入狼人杀房间">
        <div className="card-heading"><span>开始一局</span><p>扫码会自动带入房间号，确认昵称后系统自动分配空位</p></div>
        <label>你的昵称<input value={name} maxLength={12} onChange={(event) => setName(event.target.value)} placeholder="例如：小北" /></label>
        <div className="auto-seat-note"><UsersRound size={16} /><span>创建或加入后，自动分配当前最小空位</span></div>
        <button className="button primary" onClick={createRoom}><Crown size={18} />创建房间并自动入座</button>
        <div className="divider"><span>或加入已有房间</span></div>
        <label>房间号<input value={roomInput} onChange={(event) => setRoomInput(event.target.value.toUpperCase())} placeholder="例如：8F7K6" /></label>
        <div className={`scan-note ${roomInput ? 'ready' : ''}`}><QrCode size={16} /><span>{roomInput ? `已识别房间 ${roomInput}，加入后自动安排座位` : '扫主持人的二维码后，房间号会自动填入这里'}</span></div>
        <button className="button secondary" onClick={joinRoom}><UsersRound size={18} />自动分配座位并加入</button>
        {error && <p className="error-message">{error}</p>}
      </section>
    </section>
    <footer className="entry-footer"><span>9 人标准局</span><span>支持同桌与线上同玩</span><span>房间实时同步</span></footer>
  </main>
}

function RoomHeader({ room, me, name, mode, reconnecting, setMode, leaveRoom }: { room: Room; me: Me; name: string; mode: 'control' | 'play'; reconnecting: boolean; setMode: (mode: 'control' | 'play') => void; leaveRoom: () => void }) {
  const phase = phases[room.phase]
  return <header className="room-header">
    <div className="brand"><span>W</span><strong>暗号</strong></div>
    <div className="room-meta"><span className={`online-dot ${reconnecting ? 'offline-dot' : ''}`} />房间 <b>{room.code}</b><i />第 {room.day || 1} 天 · {reconnecting ? '正在恢复连接' : phase.label}</div>
    {me.isHost && <nav className="mode-switch" aria-label="切换视图"><button className={mode === 'control' ? 'active' : ''} onClick={() => setMode('control')}>主持台</button><button className={mode === 'play' ? 'active' : ''} onClick={() => setMode('play')}>我的玩家页</button></nav>}
    <div className="profile"><span>{name || '玩家'}</span><b>{me.seat}</b>{room.phase === 'lobby' && <button className="icon-button" title="离开等候房" onClick={leaveRoom}><LogOut size={15} /></button>}</div>
  </header>
}

function ControlDesk({ room, alivePlayers, qrUrl, error, startGame, advance, nextSpeaker }: { room: Room; alivePlayers: Player[]; qrUrl: string; error: string; startGame: () => void; advance: () => void; nextSpeaker: () => void }) {
  const phase = phases[room.phase]
  const PhaseIcon = phase.icon
  const latestJoin = room.events.find((item) => item.text.includes('加入了房间'))
  const command = room.phase === 'lobby' ? '发放身份，开始第 1 夜' : room.phase === 'night' ? '天亮，结算夜晚' : room.phase === 'day' ? '结束讨论，开始投票' : room.phase === 'vote' ? '结算票型，进入下一夜' : ''
  const canAdvance = room.phase === 'lobby' ? room.players.length >= 3 && room.players.every((player) => player.ready) : room.phase === 'night' ? room.nightDoneCount === alivePlayers.length : room.phase === 'day' ? true : room.phase === 'vote' ? room.voteCount === alivePlayers.length : false
  const copyJoinUrl = () => navigator.clipboard.writeText(room.joinUrl)
  return <div className="workspace">
    <aside className="seat-rail">
      <div className="rail-title"><span>玩家座位</span><b>{alivePlayers.length} 人存活</b></div>
      <div className="seat-list">{Array.from({ length: 9 }, (_, index) => {
        const player = room.players.find((item) => item.seat === index + 1)
        return <div className={`seat-item ${!player ? 'empty' : ''} ${player && !player.alive ? 'dead' : ''}`} key={index}>
          <b>{index + 1}</b><span>{player?.name ?? '空位'}</span>{player && <small><i className={player.online ? 'seat-online' : 'seat-offline'} />{room.phase === 'lobby' ? (player.ready ? '已准备' : '未准备') : player.alive ? '存活' : '出局'}</small>}
        </div>
      })}</div>
    </aside>
    <section className="control-main">
      <div className="section-top"><div><p className="eyebrow">AI 上帝正在管理本局</p><h1>{room.winner ?? phase.label}</h1><span>{phase.hint}</span></div><div className="phase-icon"><PhaseIcon size={25} /></div></div>
      <section className={`phase-panel ${room.phase}`}>
        <div className="phase-panel-copy"><span>当前阶段</span><h2>{room.phase === 'lobby' ? '邀请玩家扫码，或输入房间号入座。' : room.phase === 'night' ? '夜晚行动只显示在对应玩家设备。' : room.phase === 'day' ? (room.speakerSeat ? `现在请 ${room.speakerSeat} 号 ${room.speakerName} 发言。` : '本轮玩家已依次发言完成。') : room.phase === 'vote' ? '所有存活玩家正在各自设备投票。' : '胜负已结算，可以查看本局复盘。'}</h2><p>{room.phase === 'lobby' ? '主持人也可切换到“我的玩家页”，作为正常玩家参与。' : room.phase === 'night' ? `已完成 ${room.nightDoneCount} / ${alivePlayers.length} 个夜晚操作；主持台不显示私密内容。` : room.phase === 'day' ? '只有当前发言人的手机可以录音，AI 会把内容转写为公开记录。' : room.phase === 'vote' ? `已收到 ${room.voteCount} / ${alivePlayers.length} 票；结算前玩家可修改。` : '身份、行动和公开时间线会保留到房间过期。'}</p></div>
        <div className="phase-actions">{room.phase === 'day' && <button className="button secondary" onClick={nextSpeaker}><UserRoundCheck size={17} />下一位发言</button>}{room.phase !== 'ended' && <button className="button light" disabled={!canAdvance} onClick={room.phase === 'lobby' ? startGame : advance}>{room.phase === 'lobby' ? <Play size={17} fill="currentColor" /> : <ChevronRight size={18} />}{command}</button>}</div>
      </section>
      {error && <p className="error-message workspace-error">{error}</p>}
      <div className="control-grid">
        <section className="activity-panel"><div className="panel-header"><span>公开记录</span><ClipboardList size={17} /></div>{room.events.length ? room.events.slice(0, 5).map((event) => <p className="event-row" key={`${event.time}-${event.text}`}><time>{event.time}</time><span>{event.text}</span></p>) : <p className="empty-copy">游戏开始后，公开事件会出现在这里。</p>}</section>
        <section className="share-panel"><div><span>扫码自动入房</span><b>{room.code}</b><p>扫码后自动带入房间号，并分配空位</p><div className="join-live"><strong>{room.players.length} / 9 已入房</strong><small>{latestJoin ? latestJoin.text : '等待下一位玩家加入'}</small></div><button className="text-button" onClick={copyJoinUrl}><Copy size={14} />复制邀请链接</button></div>{qrUrl ? <img src={qrUrl} alt="加入房间二维码" /> : <QrCode size={68} />}</section>
      </div>
    </section>
    <aside className="info-rail">
      <div className="rail-title"><span>本局信息</span><Info size={16} /></div>
      <section><span>游戏配置</span><b>{room.players.length} 人当前配置</b><p>3-9 人自动配发角色；人数不足时按小局配比发放。</p></section>
      <section><span>隐私状态</span><b>私密信息已隔离</b><p>身份、查验和夜晚行动不会出现在主持台。</p></section>
      {room.tally && <section><span>公开票型</span>{Object.entries(room.tally).map(([seat, count]) => <p key={seat}>{seat} 号 · {count} 票</p>)}</section>}
    </aside>
  </div>
}

function PlayerDesk({ room, me, alivePlayers, error, witchMode, setWitchMode, submitNight, submitVote, toggleReady, recordSpeech, recording, transcribing, generateRecap, recap, recapLoading }: {
  room: Room; me: Me; alivePlayers: Player[]; error: string; witchMode: 'save' | 'poison'; setWitchMode: (mode: 'save' | 'poison') => void; submitNight: (action: object) => void; submitVote: (target: number) => void; toggleReady: () => void; recordSpeech: () => void; recording: boolean; transcribing: boolean; generateRecap: () => void; recap: Event[] | null; recapLoading: boolean
}) {
  const candidates = alivePlayers.filter((player) => player.seat !== me.seat)
  const roleType = me.role === '狼人' ? '狼人阵营' : me.role === '村民' ? '好人阵营' : '神职'
  const submitRoleAction = (target?: number) => submitNight(me.role === '女巫' ? (witchMode === 'save' ? { save: true } : { poison: target }) : { target })
  return <div className="player-layout">
    <section className="player-main">
      <div className="player-intro"><p className="eyebrow"><LockKeyhole size={14} />仅你可见</p><h1>{room.phase === 'lobby' ? '等大家入座' : me.role}</h1><p>{room.phase === 'lobby' ? '开始游戏后，你会在这里收到专属身份与私密行动。' : me.role === '狼人' ? `狼队成员：${me.wolfTeam.map((player) => `${player.seat}号 ${player.name}`).join('、')}` : me.role === '预言家' ? '每晚可以查验一名存活玩家。' : me.role === '女巫' ? '每晚可以选择救人或使用毒药。' : '白天发言、观察，并为自己的判断投票。'}</p></div>
      {room.phase !== 'lobby' && <span className="role-badge">{roleType}</span>}
      {room.phase === 'lobby' && <LobbyStatus room={room} me={me} />}
      {!me.alive && <div className="notice dead"><Eye size={17} />你已出局，本局仍可查看公开记录。</div>}
      {room.phase === 'lobby' && <button className={`button ready ${me.ready ? 'ready-done' : ''}`} onClick={toggleReady}>{me.ready ? <Check size={18} /> : <ShieldCheck size={18} />}{me.ready ? '已准备，等待主持开始' : '我已入座，点击准备'}</button>}
      {room.phase === 'night' && me.alive && <NightAction me={me} candidates={candidates} witchMode={witchMode} setWitchMode={setWitchMode} submit={submitRoleAction} />}
      {room.phase === 'vote' && me.alive && <VoteAction me={me} candidates={candidates} submitVote={submitVote} />}
      {room.phase === 'day' && me.alive && <SpeechAction isSpeaker={room.speakerSeat === me.seat} speakerSeat={room.speakerSeat} recording={recording} transcribing={transcribing} recordSpeech={recordSpeech} />}
      {me.nightResult && <div className="notice result"><Eye size={17} />查验结果：{me.nightResult}</div>}
      {error && <p className="error-message">{error}</p>}
    </section>
    <aside className="player-side">
      <section className="public-card"><div className="panel-header"><span>本局公开记录</span><ClipboardList size={17} /></div>{room.events.length ? room.events.slice(0, 4).map((event) => <p className="event-row" key={`${event.time}-${event.text}`}><time>{event.time}</time><span>{event.text}</span></p>) : <p className="empty-copy">等待游戏开始。</p>}</section>
      <section className="recap-card"><div><Sparkles size={18} /><span>被打断了？</span><p>AI 根据公开记录整理你错过的内容。</p></div><button className="button secondary small" onClick={generateRecap} disabled={recapLoading}>{recapLoading ? '整理中...' : '我刚回来，补一下'}</button>{recap && <div className="recap-result">{recap.map((event) => <p key={`${event.time}-${event.text}`}><time>{event.time}</time>{event.text}</p>)}</div>}</section>
    </aside>
  </div>
}

function LobbyStatus({ room, me }: { room: Room; me: Me }) {
  const occupiedSeats = new Set(room.players.map((player) => player.seat))
  return <section className="lobby-status">
    <div><span>已自动入座</span><strong>{me.seat} 号座位</strong><small>当前 {room.players.length} / 9 位玩家已进入房间</small></div>
    <div className="lobby-seat-grid" aria-label="房间座位状态">{Array.from({ length: 9 }, (_, index) => {
      const seat = index + 1
      return <span className={occupiedSeats.has(seat) ? 'occupied' : ''} key={seat}>{seat}</span>
    })}</div>
  </section>
}

function NightAction({ me, candidates, witchMode, setWitchMode, submit }: { me: Me; candidates: Player[]; witchMode: 'save' | 'poison'; setWitchMode: (mode: 'save' | 'poison') => void; submit: (target?: number) => void }) {
  if (me.nightDone) return <div className="notice done"><Check size={18} />夜晚行动已提交，等待天亮。</div>
  if (me.role === '村民') return <button className="button primary" onClick={() => submit()}>我已闭眼</button>
  if (me.role === '女巫') return <section className="action-card"><span>女巫行动</span><h2>{me.witchTarget ? `今夜 ${me.witchTarget} 号倒牌` : '等待狼队行动完成'}</h2><p>解药：{me.hasAntidote ? '可用' : '已使用'} · 毒药：{me.hasPoison ? '可用' : '已使用'}</p><div className="option-tabs"><button className={witchMode === 'save' ? 'active' : ''} disabled={!me.hasAntidote || !me.witchTarget} onClick={() => setWitchMode('save')}>使用解药</button><button className={witchMode === 'poison' ? 'active' : ''} disabled={!me.hasPoison} onClick={() => setWitchMode('poison')}>使用毒药</button></div>{witchMode === 'save' ? <button className="button primary" disabled={!me.hasAntidote || !me.witchTarget} onClick={() => submit()}>确认救人</button> : <SeatChoices candidates={candidates} onChoose={submit} />}</section>
  return <section className="action-card"><span>{me.role === '狼人' ? '狼人行动' : '预言家查验'}</span><h2>选择一名存活玩家</h2><SeatChoices candidates={candidates} onChoose={submit} /></section>
}

function VoteAction({ me, candidates, submitVote }: { me: Me; candidates: Player[]; submitVote: (seat: number) => void }) {
  return <section className="action-card"><span>放逐投票</span><h2>{me.hasVoted ? '已投票，结算前可修改' : '选择一名存活玩家'}</h2><SeatChoices candidates={candidates} onChoose={submitVote} /></section>
}

function SpeechAction({ isSpeaker, speakerSeat, recording, transcribing, recordSpeech }: { isSpeaker: boolean; speakerSeat: number | null; recording: boolean; transcribing: boolean; recordSpeech: () => void }) {
  if (!isSpeaker) return <div className="notice done"><UsersRound size={18} />{speakerSeat ? `当前轮到 ${speakerSeat} 号发言。` : '本轮发言已完成，等待主持进入投票。'}</div>
  return <section className="action-card speech-action"><span><Mic size={15} />轮到你发言</span><h2>开始录下你的发言</h2><p>结束录音后，AI 会将内容转成全员可见的公开记录。</p><button className={`button ${recording ? 'danger' : 'primary'}`} onClick={recordSpeech} disabled={transcribing}>{recording ? <Square size={16} fill="currentColor" /> : <Mic size={16} />}{transcribing ? 'AI 正在转写...' : recording ? '结束录音并转写' : '开始记录我的发言'}</button></section>
}

function SeatChoices({ candidates, onChoose }: { candidates: Player[]; onChoose: (seat: number) => void }) {
  return <div className="seat-choices">{candidates.map((player) => <button onClick={() => onChoose(player.seat)} key={player.seat}><b>{player.seat}</b><span>{player.name}</span></button>)}</div>
}

export default App
