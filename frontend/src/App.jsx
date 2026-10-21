import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import './App.css'
import { Brand, Icon } from './Icons'

const defaultIceServers = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
]

const buildIceServers = () => {
  const {
    VITE_ICE_SERVERS,
    VITE_TURN_URL,
    VITE_TURN_USERNAME,
    VITE_TURN_CREDENTIAL,
  } = import.meta.env

  if (VITE_ICE_SERVERS) {
    try {
      const parsed = JSON.parse(VITE_ICE_SERVERS)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
      }
      console.warn(
        'VITE_ICE_SERVERS must be a non-empty JSON array. Falling back to defaults.',
      )
    } catch (error) {
      console.warn(
        'Failed to parse VITE_ICE_SERVERS JSON. Falling back to defaults.',
        error,
      )
    }
  }

  if (VITE_TURN_URL) {
    return [
      ...defaultIceServers,
      {
        urls: VITE_TURN_URL,
        username: VITE_TURN_USERNAME || '',
        credential: VITE_TURN_CREDENTIAL || '',
      },
    ]
  }

  return defaultIceServers
}

function App() {
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000'
  const socket = useMemo(() => io(apiUrl, { autoConnect: false }), [apiUrl])
  const iceServers = useMemo(() => buildIceServers(), [])

  const [name, setName] = useState('')
  const [joined, setJoined] = useState(false)
  const [messages, setMessages] = useState({ global: [] })
  const [activeChat, setActiveChat] = useState('global')
  const [unread, setUnread] = useState({})
  const [draft, setDraft] = useState('')
  const [roomCodeInput, setRoomCodeInput] = useState('')
  const [connected, setConnected] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(
    () => window.innerWidth >= 1200,
  )
  const [search, setSearch] = useState('')
  const [roomError, setRoomError] = useState('')
  const [notice, setNotice] = useState('')
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia('(max-width: 760px)').matches,
  )

  // New state
  const [onlineUsers, setOnlineUsers] = useState([])
  const [joinedRooms, setJoinedRooms] = useState([])
  const [typingUsers, setTypingUsers] = useState(new Set())

  // WebRTC state
  const [stream, setStream] = useState(null)
  const [remoteStream, setRemoteStream] = useState(null)
  const [receivingCall, setReceivingCall] = useState(false)
  const [caller, setCaller] = useState(null)
  const [callerName, setCallerName] = useState('')
  const [callerSignal, setCallerSignal] = useState(null)
  const [callAccepted, setCallAccepted] = useState(false)
  const [callEnded, setCallEnded] = useState(false)
  const [callPartner, setCallPartner] = useState(null)
  const [callError, setCallError] = useState('')

  const listRef = useRef(null)
  const typingTimeoutRef = useRef(null)
  const isTypingRef = useRef(false)
  const activeChatRef = useRef('global')
  const localVideo = useRef(null)
  const remoteVideo = useRef(null)
  const connectionRef = useRef(null)
  const iceCandidateQueue = useRef([])
  const remoteDescSet = useRef(false)

  const [ownSocketIds, setOwnSocketIds] = useState(() => new Set())
  const identityRef = useRef(null)
  const roomsRef = useRef([])
  const streamRef = useRef(null)
  const draftsRef = useRef({})
  const nearBottomRef = useRef(true)

  const closeNavigation = () => {
    setSidebarOpen(false)
    if (isMobile)
      requestAnimationFrame(() =>
        document.querySelector('.menu-toggle')?.focus(),
      )
  }

  const selectChat = (chat) => {
    draftsRef.current[activeChatRef.current] = draft
    setDraft(draftsRef.current[chat] || '')
    nearBottomRef.current = true
    clearTimeout(typingTimeoutRef.current)
    if (isTypingRef.current) socket.emit('stop_typing')
    isTypingRef.current = false
    activeChatRef.current = chat
    setActiveChat(chat)
    closeNavigation()
    setNotice('')
    setUnread((prev) => ({ ...prev, [chat]: 0 }))
  }

  useEffect(() => {
    const onConnect = () => {
      setConnected(true)
      setOwnSocketIds((previous) => new Set([...previous, socket.id]))
      if (identityRef.current) socket.emit('join_room', identityRef.current)
      roomsRef.current.forEach((room) => socket.emit('join_private_room', room))
    }
    const onDisconnect = () => setConnected(false)
    socket.on('disconnect', onDisconnect)
    socket.on('connect_error', onDisconnect)
    socket.on('connect', onConnect)
    socket.connect()

    const onMessage = (message) => {
      setMessages((prev) => ({
        ...prev,
        global: [...(prev.global || []), message],
      }))
      if (activeChatRef.current !== 'global') {
        setUnread((prev) => ({ ...prev, global: (prev.global || 0) + 1 }))
      }
    }

    const onPrivateMessage = (message) => {
      const isMe = message.from === socket.id
      const chatId = isMe ? message.to : message.from

      setMessages((prev) => ({
        ...prev,
        [chatId]: [...(prev[chatId] || []), message],
      }))

      if (activeChatRef.current !== chatId && !isMe) {
        setUnread((prev) => ({ ...prev, [chatId]: (prev[chatId] || 0) + 1 }))
      }
    }

    const onRoomMessage = (message) => {
      const room = message.room ? `room_${message.room}` : null
      if (!room && message.system) return // Safety fallback

      const chatId = room || activeChatRef.current
      const isMe = message.from === socket.id

      setMessages((prev) => ({
        ...prev,
        [chatId]: [...(prev[chatId] || []), message],
      }))

      if (activeChatRef.current !== chatId && !isMe) {
        setUnread((prev) => ({ ...prev, [chatId]: (prev[chatId] || 0) + 1 }))
      }
    }

    const onOnlineUsers = (users) => {
      setOnlineUsers(users)
    }

    const onUserTyping = (userName) => {
      setTypingUsers((prev) => {
        const next = new Set(prev)
        next.add(userName)
        return next
      })
    }

    const onUserStopTyping = (userName) => {
      setTypingUsers((prev) => {
        const next = new Set(prev)
        next.delete(userName)
        return next
      })
    }

    const onCallUser = (data) => {
      setReceivingCall(true)
      setCallEnded(false)
      setCaller(data.from)
      setCallerName(data.name)
      setCallerSignal(data.signal)
      setCallPartner(data.from)
      remoteDescSet.current = false
      iceCandidateQueue.current = [] // Clear any stale candidates
    }

    const onCallAccepted = async (signal) => {
      setCallAccepted(true)
      if (connectionRef.current) {
        await connectionRef.current.setRemoteDescription(
          new RTCSessionDescription(signal),
        )
        remoteDescSet.current = true
        for (const candidate of iceCandidateQueue.current) {
          try {
            await connectionRef.current.addIceCandidate(
              new RTCIceCandidate(candidate),
            )
          } catch (e) {
            console.error('Error adding queued ice candidate', e)
          }
        }
        iceCandidateQueue.current = []
      }
    }

    const onIceCandidate = async (data) => {
      if (!connectionRef.current || !remoteDescSet.current) {
        iceCandidateQueue.current.push(data.candidate)
        return
      }

      try {
        await connectionRef.current.addIceCandidate(
          new RTCIceCandidate(data.candidate),
        )
      } catch (e) {
        console.error('Error adding received ice candidate', e)
      }
    }

    const onEndCall = () => {
      setCallEnded(true)
      if (connectionRef.current) {
        connectionRef.current.close()
      }
      connectionRef.current = null
      remoteDescSet.current = false
      iceCandidateQueue.current = []
      setReceivingCall(false)
      setCallAccepted(false)
      setCaller(null)
      setCallPartner(null)
      setRemoteStream(null)
      setStream((prev) => {
        if (prev) prev.getTracks().forEach((t) => t.stop())
        return null
      })
    }

    socket.on('chat_message', onMessage)
    socket.on('private_message', onPrivateMessage)
    socket.on('room_message', onRoomMessage)
    socket.on('online_users', onOnlineUsers)
    socket.on('user_typing', onUserTyping)
    socket.on('user_stop_typing', onUserStopTyping)
    socket.on('call_user', onCallUser)
    socket.on('call_accepted', onCallAccepted)
    socket.on('ice_candidate', onIceCandidate)
    socket.on('end_call', onEndCall)

    return () => {
      socket.off('disconnect', onDisconnect)
      socket.off('connect_error', onDisconnect)
      socket.off('connect', onConnect)
      clearTimeout(typingTimeoutRef.current)
      connectionRef.current?.close()
      streamRef.current?.getTracks().forEach((track) => track.stop())
      socket.off('chat_message', onMessage)
      socket.off('private_message', onPrivateMessage)
      socket.off('room_message', onRoomMessage)
      socket.off('online_users', onOnlineUsers)
      socket.off('user_typing', onUserTyping)
      socket.off('user_stop_typing', onUserStopTyping)
      socket.off('call_user', onCallUser)
      socket.off('call_accepted', onCallAccepted)
      socket.off('ice_candidate', onIceCandidate)
      socket.off('end_call', onEndCall)
      socket.disconnect()
    }
  }, [socket])

  useEffect(() => {
    if (listRef.current && nearBottomRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages, typingUsers, activeChat])

  useEffect(() => {
    if (remoteVideo.current && remoteStream) {
      remoteVideo.current.srcObject = remoteStream
      remoteVideo.current.play().catch(() => {
        // Browsers can block autoplay with sound until user interaction.
        // The call accept/start button generally provides interaction, so ignore failures.
      })
    }
  }, [remoteStream, callAccepted])

  useEffect(() => {
    if (localVideo.current && stream) {
      localVideo.current.srcObject = stream
      localVideo.current.play().catch(() => {
        // Browsers can block autoplay with sound until user interaction.
        // The call accept/start button generally provides interaction, so ignore failures.
      })
    }
  }, [stream])

  useEffect(() => {
    if (!sidebarOpen || !isMobile) return
    const closeOnEscape = (event) => {
      if (event.key === 'Tab') {
        const items = [
          ...document.querySelectorAll(
            '#chat-navigation button:not(:disabled), #chat-navigation input',
          ),
        ].filter((item) => item.getClientRects().length)
        const first = items[0],
          last = items[items.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }
      if (event.key === 'Escape') {
        setSidebarOpen(false)
        requestAnimationFrame(() =>
          document.querySelector('.menu-toggle')?.focus(),
        )
      }
    }
    document.addEventListener('keydown', closeOnEscape)
    document.querySelector('#chat-navigation .mobile-only')?.focus()
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [sidebarOpen, isMobile])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)')
    const onChange = (event) => setIsMobile(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (!joined || !(receivingCall || stream || callAccepted)) return
    const dialog = document.querySelector(
      '.active-call-overlay, .call-modal-overlay',
    )
    const previousFocus = document.activeElement
    const focusFrame = requestAnimationFrame(() =>
      dialog?.querySelector('button')?.focus(),
    )
    const trapFocus = (event) => {
      if (event.key !== 'Tab') return
      const buttons = [...dialog.querySelectorAll('button:not(:disabled)')]
      const first = buttons[0],
        last = buttons[buttons.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    dialog?.addEventListener('keydown', trapFocus)
    return () => {
      cancelAnimationFrame(focusFrame)
      dialog?.removeEventListener('keydown', trapFocus)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [joined, receivingCall, stream, callAccepted])

  const joinRoom = (event) => {
    event.preventDefault()
    const cleanName = name.trim().slice(0, 24)
    if (!cleanName || !connected) {
      return
    }
    identityRef.current = cleanName
    socket.emit('join_room', cleanName)
    setName(cleanName)
    setJoined(true)
  }

  const joinPrivateRoom = (e) => {
    e.preventDefault()
    const code = roomCodeInput
      .trim()
      .slice(0, 32)
      .replace(/[^a-zA-Z0-9_-]/g, '')
    if (!connected) return
    if (!code) {
      setRoomError('Use letters, numbers, dashes, or underscores.')
      return
    }
    setRoomError('')

    if (!joinedRooms.includes(code)) {
      socket.emit('join_private_room', code)
      roomsRef.current = [...roomsRef.current, code]
      setJoinedRooms(roomsRef.current)
    }

    selectChat(`room_${code}`)
    setRoomCodeInput('')
  }

  const handleDraftChange = (e) => {
    setDraft(e.target.value)

    if (!joined || !connected || activeChat !== 'global') return

    if (!isTypingRef.current) {
      socket.emit('typing')
      isTypingRef.current = true
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }

    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('stop_typing')
      isTypingRef.current = false
    }, 1500)
  }

  const callUser = async (idToCall) => {
    try {
      setCallError('')
      setCallEnded(false)
      remoteDescSet.current = false
      iceCandidateQueue.current = []
      setCallPartner(idToCall)
      const constraints = {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      }
      const currentStream =
        await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = currentStream
      setStream(currentStream)
      if (localVideo.current) localVideo.current.srcObject = currentStream

      const configuration = { iceServers }
      const peer = new RTCPeerConnection(configuration)
      connectionRef.current = peer

      currentStream
        .getTracks()
        .forEach((track) => peer.addTrack(track, currentStream))

      peer.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('ice_candidate', {
            to: idToCall,
            candidate: event.candidate,
          })
        }
      }

      peer.ontrack = (event) => {
        setRemoteStream(event.streams[0])
        if (remoteVideo.current) {
          remoteVideo.current.srcObject = event.streams[0]
          remoteVideo.current.play().catch(() => {})
        }
      }

      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      socket.emit('call_user', {
        userToCall: idToCall,
        signalData: offer,
        from: socket.id,
        name,
      })
    } catch (err) {
      leaveCall()
      setCallError(
        'Could not start the call. Check camera and microphone permissions.',
      )
      console.error('Call failed', err)
    }
  }

  const answerCall = async () => {
    setCallError('')
    setCallAccepted(true)
    setCallEnded(false)
    remoteDescSet.current = false
    try {
      const constraints = {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      }
      const currentStream =
        await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = currentStream
      setStream(currentStream)
      if (localVideo.current) localVideo.current.srcObject = currentStream

      const configuration = { iceServers }
      const peer = new RTCPeerConnection(configuration)
      connectionRef.current = peer

      currentStream
        .getTracks()
        .forEach((track) => peer.addTrack(track, currentStream))

      peer.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('ice_candidate', {
            to: caller,
            candidate: event.candidate,
          })
        }
      }

      peer.ontrack = (event) => {
        setRemoteStream(event.streams[0])
        if (remoteVideo.current) {
          remoteVideo.current.srcObject = event.streams[0]
          remoteVideo.current.play().catch(() => {})
        }
      }

      await peer.setRemoteDescription(new RTCSessionDescription(callerSignal))
      remoteDescSet.current = true
      for (const candidate of iceCandidateQueue.current) {
        try {
          await peer.addIceCandidate(new RTCIceCandidate(candidate))
        } catch (e) {
          console.error('Error adding queued ice candidate', e)
        }
      }
      iceCandidateQueue.current = []
      const answer = await peer.createAnswer()
      await peer.setLocalDescription(answer)

      socket.emit('answer_call', { signal: answer, to: caller })
    } catch (err) {
      leaveCall()
      setCallError(
        'Could not answer the call. Check camera and microphone permissions.',
      )
      console.error(err)
    }
  }

  const leaveCall = () => {
    setCallEnded(true)
    if (connectionRef.current) {
      connectionRef.current.close()
    }
    if (callPartner) {
      socket.emit('end_call', { to: callPartner })
    }
    connectionRef.current = null
    remoteDescSet.current = false
    iceCandidateQueue.current = []
    setReceivingCall(false)
    setCallAccepted(false)
    setCaller(null)
    setCallPartner(null)
    setRemoteStream(null)
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setStream(null)
  }

  const sendMessage = (event) => {
    event.preventDefault()
    const message = draft.trim()
    if (!message || !joined || !canSend) {
      return
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }
    if (isTypingRef.current) {
      socket.emit('stop_typing')
      isTypingRef.current = false
    }

    nearBottomRef.current = true
    if (activeChat === 'global') {
      socket.emit('send_message', message)
    } else if (activeChat.startsWith('room_')) {
      const roomCode = activeChat.replace('room_', '')
      socket.emit('send_room_message', { room: roomCode, text: message })
    } else {
      socket.emit('send_private_message', { to: activeChat, text: message })
    }
    setDraft('')
  }

  // Helper to format typing text
  const getTypingText = () => {
    if (typingUsers.size === 0) return null
    const users = Array.from(typingUsers)
    if (users.length === 1) return `${users[0]} is typing...`
    if (users.length === 2) return `${users[0]} and ${users[1]} are typing...`
    return 'Multiple users are typing...'
  }

  const isRoom = activeChat.startsWith('room_')
  const isGlobal = activeChat === 'global'
  const peer = onlineUsers.find((user) => user.id === activeChat)
  const chatTitle = isGlobal
    ? 'Global Room'
    : isRoom
      ? activeChat.slice(5)
      : peer?.name || 'Disconnected user'
  const chatIcon = isGlobal ? 'globe' : isRoom ? 'hash' : 'chat'
  const canSend = connected && (isGlobal || isRoom || Boolean(peer))
  const filteredUsers = onlineUsers.filter((user) =>
    user.name.toLowerCase().includes(search.toLowerCase()),
  )
  const filteredRooms = joinedRooms.filter((room) =>
    room.toLowerCase().includes(search.toLowerCase()),
  )
  const chatMessages = messages[activeChat] || []
  const copyRoomCode = async () => {
    try {
      await navigator.clipboard.writeText(activeChat.slice(5))
      setNotice('Room code copied. Share it with a friend!')
    } catch {
      setNotice(
        `Your room code is ${activeChat.slice(5)}. Select it in the header to copy.`,
      )
    }
  }

  if (!joined) {
    return (
      <main className="welcome-page">
        <header className="welcome-nav">
          <Brand />
          <span className="nav-note">
            A little closer, wherever you are <Icon name="globe" size={16} />
          </span>
        </header>
        <div className="welcome-content">
          <section className="welcome-story">
            <span className="eyebrow">
              <span className="status-dot" /> GOOD CONVERSATIONS START HERE
            </span>
            <h1>
              Your people.
              <br />
              Your space.
              <br />
              <em>Your orbit.</em>
            </h1>
            <p className="welcome-description">
              A place for quick hellos and conversations that go somewhere. Drop
              in, find your people, and make yourself at home.
            </p>
            <div className="welcome-features">
              <span>
                <Icon name="chat" size={17} /> Real-time chat
              </span>
              <span>
                <Icon name="video" size={17} /> Face-to-face calls
              </span>
              <span>
                <Icon name="hash" size={17} /> Your own rooms
              </span>
            </div>
            <div className="orbit-art" aria-hidden="true">
              <div className="orbit-ring ring-one" />
              <div className="orbit-ring ring-two" />
              <div className="orbit-center">
                <Icon name="orbit" size={58} />
              </div>
              <div className="orbit-note note-one">
                <span className="art-avatar">J</span> Hey, you made it!{' '}
                <span>✦</span>
              </div>
              <div className="orbit-note note-two">
                <span className="art-avatar peach">M</span> Always room for one
                more.
              </div>
              <span className="orbit-dot dot-one" />
              <span className="orbit-dot dot-two" />
            </div>
          </section>
          <section className="join-card" aria-labelledby="join-heading">
            <span className="card-icon">
              <Icon name="spark" size={26} />
            </span>
            <span className="eyebrow">COME ON IN</span>
            <h2 id="join-heading">
              A conversation
              <br />
              is waiting.
            </h2>
            <p>
              No account. No long introductions.
              <br />
              Just a name, and you’re in.
            </p>
            <form className="join-form" onSubmit={joinRoom}>
              <label htmlFor="display-name">What should we call you?</label>
              <input
                id="display-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Enter your display name"
                maxLength={24}
                autoComplete="nickname"
                required
              />
              <button
                className="primary-button"
                type="submit"
                disabled={!name.trim() || !connected}
              >
                Join Space <Icon name="arrow" />
              </button>
            </form>
            <div
              className={`connection-note ${connected ? '' : 'is-offline'}`}
              role="status"
            >
              <span className="status-dot" />
              {connected ? 'Ready when you are' : 'Connecting to your space…'}
            </div>
            <div className="join-card-footer">
              <Icon name="people" size={18} />
              <span>Be yourself. Be kind. Say hello.</span>
            </div>
          </section>
        </div>
        <footer className="welcome-footer">
          <span>Less scrolling. More connecting.</span>
          <span>Made for the moments between.</span>
        </footer>
      </main>
    )
  }

  return (
    <main
      className={`app-layout ${sidebarOpen ? 'nav-open' : ''} ${detailsOpen ? 'details-open' : ''}`}
    >
      {sidebarOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={closeNavigation}
        />
      )}
      <aside
        className="sidebar"
        id="chat-navigation"
        aria-label="Conversations"
        role={isMobile && sidebarOpen ? 'dialog' : undefined}
        aria-modal={isMobile && sidebarOpen ? true : undefined}
      >
        <div className="sidebar-header">
          <Brand />
          <button
            className="icon-button mobile-only"
            aria-label="Close navigation"
            onClick={closeNavigation}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="workspace-label">
          <span className="workspace-symbol">O</span>
          <div>
            Your workspace<small>Make yourself at home</small>
          </div>
          <Icon name="spark" size={16} />
        </div>
        <label className="search-field">
          <Icon name="search" size={17} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find people or rooms"
            aria-label="Find people or rooms"
          />
          {search && (
            <button
              className="clear-search"
              aria-label="Clear search"
              onClick={() => setSearch('')}
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </label>
        <nav className="user-list" aria-label="Spaces and people">
          <div className="menu-section-header">
            YOUR SPACES <span>{joinedRooms.length + 1}</span>
          </div>
          {(!search || 'global room'.includes(search.toLowerCase())) && (
            <button
              className={`user-item menu-cta ${isGlobal ? 'active' : ''}`}
              aria-current={isGlobal ? 'page' : undefined}
              onClick={() => selectChat('global')}
            >
              <span className="item-icon">
                <Icon name="globe" />
              </span>
              <span className="item-label">
                Global Room<small>A little bit of everyone</small>
              </span>
              {unread.global > 0 && (
                <span className="unread-badge">{unread.global}</span>
              )}
            </button>
          )}
          {filteredRooms.map((room) => (
            <button
              key={room}
              className={`user-item room-item ${activeChat === `room_${room}` ? 'active' : ''}`}
              aria-current={activeChat === `room_${room}` ? 'page' : undefined}
              onClick={() => selectChat(`room_${room}`)}
            >
              <span className="item-icon">
                <Icon name="hash" />
              </span>
              <span className="item-label">
                {room}
                <small>Room conversation</small>
              </span>
              {unread[`room_${room}`] > 0 && (
                <span className="unread-badge">{unread[`room_${room}`]}</span>
              )}
            </button>
          ))}
          <form className="join-room-form" onSubmit={joinPrivateRoom}>
            <label className="sr-only" htmlFor="room-code">
              Enter room code
            </label>
            <input
              id="room-code"
              className="room-input"
              placeholder="Enter room code"
              value={roomCodeInput}
              maxLength={32}
              onChange={(event) => {
                setRoomCodeInput(event.target.value)
                setRoomError('')
              }}
            />
            <button
              className="room-btn"
              type="submit"
              aria-label="Join private room"
              disabled={!roomCodeInput.trim() || !connected}
            >
              <Icon name="plus" size={18} />
            </button>
          </form>
          {roomError && (
            <p className="field-error" role="alert">
              {roomError}
            </p>
          )}
          <p className="room-hint">Use the same code to meet in a room.</p>
          <div className="menu-section-header people-heading">
            PEOPLE ONLINE <span>{onlineUsers.length}</span>
          </div>
          {filteredUsers.map((user) => (
            <button
              key={user.id}
              className={`user-item person-item ${activeChat === user.id ? 'active' : ''}`}
              disabled={user.id === socket.id}
              aria-current={activeChat === user.id ? 'page' : undefined}
              onClick={() => selectChat(user.id)}
            >
              <span
                className={`avatar-pill avatar-${user.name.charCodeAt(0) % 4}`}
              >
                {user.name.slice(0, 1).toUpperCase()}
                <i className="status-dot" />
              </span>
              <span className="item-label">
                {user.name}
                <small>
                  {user.id === socket.id
                    ? 'That’s you'
                    : 'Here for a conversation'}
                </small>
              </span>
              {user.id === socket.id && <span className="you-tag">You</span>}
              {unread[user.id] > 0 && (
                <span className="unread-badge">{unread[user.id]}</span>
              )}
            </button>
          ))}
          {search &&
            !filteredUsers.length &&
            !filteredRooms.length &&
            !'global room'.includes(search.toLowerCase()) && (
              <div className="search-empty">
                <Icon name="search" />
                <p>No matches for “{search}”</p>
                <button onClick={() => setSearch('')}>Clear search</button>
              </div>
            )}
        </nav>
        <div className="sidebar-bottom">
          <span className="avatar-pill self-avatar">
            {name.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{name}</strong>
            <span
              className={
                connected ? 'connection-label' : 'connection-label offline'
              }
            >
              <i className="status-dot" />
              {connected ? 'You’re online' : 'Reconnecting…'}
            </span>
          </div>
          <button
            className="icon-button"
            title="Leave space"
            aria-label="Leave space"
            onClick={() => window.location.reload()}
          >
            <Icon name="exit" size={18} />
          </button>
        </div>
      </aside>

      <section
        className="chat-container"
        aria-label="Chat"
        inert={isMobile && sidebarOpen}
      >
        <header className="chat-header">
          <button
            className="icon-button mobile-only menu-toggle"
            aria-label="Open navigation"
            aria-expanded={sidebarOpen}
            aria-controls="chat-navigation"
            onClick={() => setSidebarOpen(true)}
          >
            <Icon name="menu" />
          </button>
          <span className="header-room-icon">
            <Icon name={chatIcon} size={23} />
          </span>
          <div className="header-info">
            <h1>{chatTitle}</h1>
            <p>
              <span
                className={`status-dot ${connected ? '' : 'disconnected'}`}
              />
              {!connected
                ? 'Reconnecting…'
                : isGlobal
                  ? `${onlineUsers.length} online · Everyone’s welcome`
                  : isRoom
                    ? 'A space for your people'
                    : peer
                      ? 'Online · Direct conversation'
                      : 'This person is offline'}
            </p>
          </div>
          <div className="header-actions">
            {!isGlobal && !isRoom && (
              <button
                className="icon-button call-btn"
                onClick={() => callUser(activeChat)}
                disabled={Boolean(callPartner) || !canSend}
                title="Start Video Call"
                aria-label="Start Video Call"
              >
                <Icon name="video" />
              </button>
            )}
            {isRoom && (
              <button
                className="icon-button"
                title="Copy room code"
                aria-label="Copy room code"
                onClick={copyRoomCode}
              >
                <Icon name="copy" />
              </button>
            )}
            <button
              className={`icon-button info-toggle ${detailsOpen ? 'selected' : ''}`}
              aria-label="Conversation details"
              aria-expanded={detailsOpen}
              onClick={() => setDetailsOpen(!detailsOpen)}
            >
              <Icon name="info" />
            </button>
          </div>
        </header>
        {!connected && (
          <div className="connection-banner" role="status">
            Connection interrupted. We’ll reconnect automatically. Your draft is
            safe.
          </div>
        )}
        {callError && (
          <div className="error-banner" role="alert">
            {callError}
            <button
              className="icon-button"
              aria-label="Dismiss call error"
              onClick={() => setCallError('')}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="notice-banner" role="status">
            <Icon name="check" size={17} />
            {notice}
            <button
              className="icon-button"
              aria-label="Dismiss notification"
              onClick={() => setNotice('')}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        <div className="messages-area">
          <div
            className="messages-scroll"
            ref={listRef}
            onScroll={(event) => {
              const element = event.currentTarget
              nearBottomRef.current =
                element.scrollHeight -
                  element.scrollTop -
                  element.clientHeight <
                80
            }}
            role="log"
            aria-label={`Messages in ${chatTitle}`}
            aria-live="polite"
            aria-relevant="additions text"
          >
            <div className="conversation-intro">
              <span className="intro-icon">
                <Icon name={chatIcon} size={30} />
              </span>
              <span className="eyebrow">
                {isGlobal
                  ? 'THE COMMON GROUND'
                  : isRoom
                    ? 'A LITTLE SPACE OF YOUR OWN'
                    : 'JUST THE TWO OF YOU'}
              </span>
              <h2>
                {isGlobal
                  ? 'Good company starts with hello.'
                  : isRoom
                    ? `Welcome to #${chatTitle}.`
                    : `Say hello to ${chatTitle}.`}
              </h2>
              <p>
                {isGlobal
                  ? 'Share a thought, ask a question, or see where the conversation takes you.'
                  : isRoom
                    ? 'You found your corner of Orbit. Share the room code to bring your people together.'
                    : 'A quick check-in or a long catch-up. This conversation is yours.'}
              </p>
              {!chatMessages.some((message) => !message.system) && (
                <span className="first-message-prompt">
                  <Icon name="spark" size={14} /> Be the first to break the ice
                </span>
              )}
            </div>
            {chatMessages.map((msg, index) => {
              const isSystem = msg.system === true
              const isMine = ownSocketIds.has(msg.from) && !isSystem
              const day = new Date(msg.timestamp).toLocaleDateString(
                undefined,
                { month: 'long', day: 'numeric' },
              )
              const previousDay =
                index > 0
                  ? new Date(
                      chatMessages[index - 1].timestamp,
                    ).toLocaleDateString(undefined, {
                      month: 'long',
                      day: 'numeric',
                    })
                  : null
              return (
                <Fragment key={msg.id}>
                  {day !== previousDay && (
                    <div className="date-divider">
                      <span>{day}</span>
                    </div>
                  )}
                  {isSystem ? (
                    <div className="message system">
                      <p>{msg.text}</p>
                    </div>
                  ) : (
                    <article
                      className={`message ${isMine ? 'mine' : 'theirs'}`}
                    >
                      <span
                        className={`message-avatar avatar-${msg.user.charCodeAt(0) % 4}`}
                        aria-hidden="true"
                      >
                        {msg.user.slice(0, 1).toUpperCase()}
                      </span>
                      <div className="message-content">
                        <div className="message-meta">
                          <span className="msg-author">
                            {isMine ? 'You' : msg.user}
                          </span>
                          <time dateTime={msg.timestamp} className="msg-time">
                            {new Date(msg.timestamp).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </time>
                        </div>
                        <div className="msg-bubble">
                          <p>{msg.text}</p>
                        </div>
                      </div>
                    </article>
                  )}
                </Fragment>
              )
            })}
            {typingUsers.size > 0 && isGlobal && (
              <div className="typing-indicator">
                <div className="dots">
                  <span />
                  <span />
                  <span />
                </div>
                <span>{getTypingText()}</span>
              </div>
            )}
          </div>
        </div>
        <div className="composer-area">
          <form className="composer" onSubmit={sendMessage}>
            <label className="sr-only" htmlFor="message-draft">
              Message {chatTitle}
            </label>
            <textarea
              id="message-draft"
              rows={1}
              value={draft}
              onChange={handleDraftChange}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault()
                  event.currentTarget.form.requestSubmit()
                }
              }}
              placeholder={
                canSend ? 'Type a message...' : 'Waiting for connection…'
              }
              maxLength={500}
            />
            <button
              type="submit"
              aria-label="Send message"
              disabled={!draft.trim() || !canSend}
            >
              <Icon name="send" size={20} />
            </button>
          </form>
          <div className="composer-hint">
            <span>
              <kbd>Enter</kbd> to send <span className="hint-separator">·</span>{' '}
              <kbd>Shift + Enter</kbd> for a new line
            </span>
            <span>
              {draft.length > 0
                ? `${draft.length} / 500`
                : 'A little kindness goes a long way.'}
            </span>
          </div>
        </div>
      </section>
      <aside
        className="details-panel"
        aria-label="Conversation details"
        hidden={!detailsOpen}
        inert={isMobile && sidebarOpen}
      >
        <div className="details-heading">
          THE LITTLE DETAILS
          <button
            className="icon-button"
            aria-label="Close details"
            onClick={() => setDetailsOpen(false)}
          >
            <Icon name="close" size={17} />
          </button>
        </div>
        <div className="detail-orbit">
          <span className="detail-orbit-ring" />
          <Icon name={chatIcon} size={38} />
          <i />
        </div>
        <h2>{chatTitle}</h2>
        <p className="details-description">
          {isGlobal
            ? 'An open door to good conversation.'
            : isRoom
              ? 'A shared code. A shared space.'
              : 'A little closer, even from a distance.'}
        </p>
        <span className="detail-tag">
          <Icon
            name={isGlobal ? 'globe' : isRoom ? 'hash' : 'chat'}
            size={13}
          />
          {isGlobal
            ? 'Open to everyone'
            : isRoom
              ? 'Join with a room code'
              : 'Direct conversation'}
        </span>
        <div className="details-rule" />
        <div className="details-note">
          <Icon name="spark" size={19} />
          <h3>Make room for connection.</h3>
          <p>
            Say hello. Share something good. Give a new perspective a little
            space.
          </p>
        </div>
        {isRoom ? (
          <button className="secondary-button" onClick={copyRoomCode}>
            <Icon name="copy" size={16} /> Copy room code
          </button>
        ) : (
          <div className="details-facts">
            <span>
              <Icon name="people" size={17} />
              {isGlobal
                ? `${onlineUsers.length} people online`
                : peer
                  ? 'Available for a chat'
                  : 'Currently offline'}
            </span>
            <span>
              <Icon name="chat" size={17} />
              Conversations live in the moment
            </span>
          </div>
        )}
        <div className="details-footnote">
          <Icon name="orbit" size={20} />
          <p>
            A small space.
            <br />A world of possibility.
          </p>
        </div>
      </aside>

      {/* Incoming Call Modal */}
      {receivingCall && !callAccepted && (
        <div
          className="call-modal-overlay fade-in"
          role="dialog"
          aria-modal="true"
          aria-labelledby="incoming-call-title"
        >
          <div className="call-modal scale-in">
            <div className="call-modal-icon pulse-circle">
              <svg
                viewBox="0 0 24 24"
                width="24"
                height="24"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="23 7 16 12 23 17 23 7"></polygon>
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
              </svg>
            </div>
            <h3 id="incoming-call-title">Incoming Video Call</h3>
            <p>
              <strong>{callerName}</strong> is calling you...
            </p>
            <div className="call-actions">
              <button className="accept-btn" onClick={answerCall}>
                Accept
              </button>
              <button className="decline-btn" onClick={leaveCall}>
                Decline
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active Call UI */}
      {(stream || callAccepted) && (
        <div
          className="active-call-overlay fade-in"
          role="dialog"
          aria-modal="true"
          aria-label="Video call"
        >
          <div className="video-container">
            <div className="remote-video-wrapper">
              <video
                playsInline
                ref={remoteVideo}
                autoPlay
                className="remote-video"
                style={{
                  display: callAccepted && !callEnded ? 'block' : 'none',
                }}
              />
              {!(callAccepted && !callEnded) && (
                <div className="calling-placeholder">
                  <div className="dots">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                  <p>{receivingCall ? 'Connecting...' : 'Calling...'}</p>
                </div>
              )}
            </div>
            {stream && (
              <div className="local-video-wrapper">
                <video
                  playsInline
                  muted
                  ref={localVideo}
                  autoPlay
                  className="local-video"
                />
              </div>
            )}
            <div className="call-controls">
              <button className="hangup-btn" onClick={leaveCall}>
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  stroke="currentColor"
                  strokeWidth="2"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"></path>
                  <line x1="23" y1="1" x2="1" y2="23"></line>
                </svg>
                Hang Up
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

export default App
