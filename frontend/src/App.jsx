import { useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import './App.css'

const defaultIceServers = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' }
]

const buildIceServers = () => {
  const { VITE_ICE_SERVERS, VITE_TURN_URL, VITE_TURN_USERNAME, VITE_TURN_CREDENTIAL } = import.meta.env

  if (VITE_ICE_SERVERS) {
    try {
      const parsed = JSON.parse(VITE_ICE_SERVERS)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
      }
      console.warn('VITE_ICE_SERVERS must be a non-empty JSON array. Falling back to defaults.')
    } catch (error) {
      console.warn('Failed to parse VITE_ICE_SERVERS JSON. Falling back to defaults.', error)
    }
  }

  if (VITE_TURN_URL) {
    return [
      ...defaultIceServers,
      {
        urls: VITE_TURN_URL,
        username: VITE_TURN_USERNAME || '',
        credential: VITE_TURN_CREDENTIAL || ''
      }
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
  
  const listRef = useRef(null)
  const typingTimeoutRef = useRef(null)
  const isTypingRef = useRef(false)
  const activeChatRef = useRef('global')
  const localVideo = useRef(null)
  const remoteVideo = useRef(null)
  const connectionRef = useRef(null)
  const iceCandidateQueue = useRef([])
  const remoteDescSet = useRef(false)

  useEffect(() => {
    activeChatRef.current = activeChat
    if (unread[activeChat]) {
      setUnread(prev => ({ ...prev, [activeChat]: 0 }))
    }
  }, [activeChat, unread])

  useEffect(() => {
    socket.connect()

    const onMessage = (message) => {
      setMessages((prev) => ({ ...prev, global: [...(prev.global || []), message] }))
      if (activeChatRef.current !== 'global') {
        setUnread((prev) => ({ ...prev, global: (prev.global || 0) + 1 }))
      }
    }

    const onPrivateMessage = (message) => {
      const isMe = message.from === socket.id
      const chatId = isMe ? message.to : message.from
      
      setMessages((prev) => ({ ...prev, [chatId]: [...(prev[chatId] || []), message] }))
      
      if (activeChatRef.current !== chatId && !isMe) {
        setUnread((prev) => ({ ...prev, [chatId]: (prev[chatId] || 0) + 1 }))
      }
    }

    const onRoomMessage = (message) => {
      const room = message.room ? `room_${message.room}` : null
      if (!room && message.user === 'system') return // Safety fallback

      // The backend createSystemMessage doesn't include a room param by default, 
      // but when it broadcasts room_message, it's sent to the room code. To handle 
      // simple system messages during join, we map by active chat if room is missing.
      // Better: backend now includes room:code.
      const chatId = room || activeChatRef.current
      const isMe = message.from === socket.id || message.user === name
      
      setMessages((prev) => ({ ...prev, [chatId]: [...(prev[chatId] || []), message] }))
      
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
        await connectionRef.current.setRemoteDescription(new RTCSessionDescription(signal))
        remoteDescSet.current = true
        for (const candidate of iceCandidateQueue.current) {
          try {
            await connectionRef.current.addIceCandidate(new RTCIceCandidate(candidate))
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
        await connectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate))
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
      setStream(prev => {
        if (prev) prev.getTracks().forEach(t => t.stop())
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
    if (listRef.current) {
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

  const joinRoom = (event) => {
    event.preventDefault()
    const cleanName = name.trim().slice(0, 24)
    if (!cleanName) {
      return
    }
    socket.emit('join_room', cleanName)
    setName(cleanName)
    setJoined(true)
  }

  const joinPrivateRoom = (e) => {
    e.preventDefault()
    const code = roomCodeInput.trim()
    if (!code) return
    
    if (!joinedRooms.includes(code)) {
      socket.emit('join_private_room', code)
      setJoinedRooms(prev => [...prev, code])
    }
    
    setActiveChat(`room_${code}`)
    setRoomCodeInput('')
  }

  const handleDraftChange = (e) => {
    setDraft(e.target.value)
    
    if (!joined) return;

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
      setCallEnded(false)
      remoteDescSet.current = false
      iceCandidateQueue.current = []
      setCallPartner(idToCall)
      const constraints = {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      }
      const currentStream = await navigator.mediaDevices.getUserMedia(constraints)
      setStream(currentStream)
      if (localVideo.current) localVideo.current.srcObject = currentStream

      const configuration = { iceServers }
      const peer = new RTCPeerConnection(configuration)
      connectionRef.current = peer

      currentStream.getTracks().forEach(track => peer.addTrack(track, currentStream))

      peer.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('ice_candidate', { to: idToCall, candidate: event.candidate })
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
      socket.emit('call_user', { userToCall: idToCall, signalData: offer, from: socket.id, name })
    } catch (err) {
      console.error("Failed to get local stream", err)
    }
  }

  const answerCall = async () => {
    setCallAccepted(true)
    setCallEnded(false)
    remoteDescSet.current = false
    try {
      const constraints = {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      }
      const currentStream = await navigator.mediaDevices.getUserMedia(constraints)
      setStream(currentStream)
      if (localVideo.current) localVideo.current.srcObject = currentStream

      const configuration = { iceServers }
      const peer = new RTCPeerConnection(configuration)
      connectionRef.current = peer

      currentStream.getTracks().forEach(track => peer.addTrack(track, currentStream))

      peer.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('ice_candidate', { to: caller, candidate: event.candidate })
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
    if (stream) {
      stream.getTracks().forEach(track => track.stop())
      setStream(null)
    }
  }

  const sendMessage = (event) => {
    event.preventDefault()
    const message = draft.trim()
    if (!message || !joined) {
      return
    }
    
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }
    if (isTypingRef.current) {
      socket.emit('stop_typing')
      isTypingRef.current = false
    }

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

  if (!joined) {
    return (
      <main className="login-page">
        <div className="login-box tilt-in">
          <div className="logo-container">
            <div className="pulse-circle"></div>
            <h1>Orbit Chat</h1>
          </div>
          <p className="subtitle">Join the conversation instantly.</p>
          <form className="join-form" onSubmit={joinRoom}>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Enter your display name"
              maxLength={24}
              autoFocus
            />
            <button type="submit">Join Space</button>
          </form>
        </div>
      </main>
    )
  }

  return (
    <main className="app-layout fade-in">
      <aside className="sidebar slide-in-left">
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <h2>Orbit</h2>
            <p>Command Deck</p>
          </div>
          <span className="online-badge">{onlineUsers.length} Online</span>
        </div>
        <div className="user-list">
          <div className="menu-section-header">Spaces</div>

          <div
            className={`user-item menu-cta ${activeChat === 'global' ? 'active' : ''}`}
            onClick={() => setActiveChat('global')}
          >
            <span className="item-icon global-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M2 12h20"></path>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
              </svg>
            </span>
            <span className="item-label">Global Room</span>
            {unread.global > 0 && <span className="unread-badge">{unread.global}</span>}
          </div>

          <div className="sidebar-spacer"></div>

          <div className="menu-section-header">Private Rooms</div>
          
          <form className="join-room-form" onSubmit={joinPrivateRoom}>
            <input 
              type="text" 
              placeholder="Enter room code" 
              value={roomCodeInput}
              onChange={(e) => setRoomCodeInput(e.target.value)}
              className="room-input"
            />
            <button type="submit" className="room-btn" aria-label="Join private room">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
          </form>

          {joinedRooms.map(room => (
            <div 
              key={room} 
              className={`user-item room-item ${activeChat === `room_${room}` ? 'active' : ''}`}
              onClick={() => setActiveChat(`room_${room}`)}
            >
              <span className="item-icon room-icon" aria-hidden="true">#</span>
              <span className="item-label">{room}</span>
              {unread[`room_${room}`] > 0 && <span className="unread-badge">{unread[`room_${room}`]}</span>}
            </div>
          ))}

          <div className="sidebar-spacer"></div>

          <div className="menu-section-header">People Online</div>
          
          {onlineUsers.map(u => (
            <div 
              key={u.id} 
              className={`user-item ${activeChat === u.id ? 'active' : ''} ${u.id === socket.id ? 'disabled' : ''}`}
              onClick={() => { if (u.id !== socket.id) setActiveChat(u.id) }}
            >
              <span className="avatar-pill" aria-hidden="true">{u.name.slice(0, 1).toUpperCase()}</span>
              <span className="item-label">{u.name}</span>
              <span className="status-dot online"></span>
              {u.id === socket.id && <span className="you-tag">(You)</span>}
              {unread[u.id] > 0 && <span className="unread-badge">{unread[u.id]}</span>}
            </div>
          ))}
        </div>
      </aside>
      
      <section className="chat-container">
        <header className="chat-header">
          <div className="header-info">
            <h2>
              {activeChat === 'global' 
                ? 'Global Room' 
                : activeChat.startsWith('room_') 
                  ? `Room: #${activeChat.replace('room_', '')}`
                  : `Chat with ${onlineUsers.find(u => u.id === activeChat)?.name || 'User'}`}
            </h2>
            <p>Connected as <strong>{name}</strong></p>
          </div>
          {activeChat !== 'global' && !activeChat.startsWith('room_') && (
            <div className="header-actions">
              <button 
                className="action-btn call-btn" 
                onClick={() => callUser(activeChat)}
                title="Start Video Call"
              >
                <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="23 7 16 12 23 17 23 7"></polygon>
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                </svg>
              </button>
            </div>
          )}
        </header>

        <div className="messages-area">
          <div className="messages-scroll" ref={listRef}>
            {(messages[activeChat] || []).map((msg) => {
              const isSystem = msg.user === 'system';
              const isMine = msg.user === name && !isSystem;

              if (isSystem) {
                return (
                  <div key={msg.id} className="message system scale-in">
                    <p>{msg.text}</p>
                  </div>
                )
              }

              return (
                <article key={msg.id} className={`message ${isMine ? 'mine' : 'theirs'} slide-up`}>
                  {!isMine && <span className="msg-author">{msg.user}</span>}
                  <div className="msg-bubble">
                    <p>{msg.text}</p>
                  </div>
                  <span className="msg-time">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </article>
              )
            })}
            
            {typingUsers.size > 0 && (
              <div className="typing-indicator fade-in">
                <span className="typing-text">{getTypingText()}</span>
                <div className="dots">
                  <span></span><span></span><span></span>
                </div>
              </div>
            )}
          </div>
        </div>

        <form className="composer slide-up" onSubmit={sendMessage}>
          <input
            type="text"
            value={draft}
            onChange={handleDraftChange}
            placeholder="Type a message..."
            maxLength={500}
            autoFocus
          />
          <button type="submit" disabled={!draft.trim()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="send-icon">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </form>
      </section>

      {/* Incoming Call Modal */}
      {receivingCall && !callAccepted && (
        <div className="call-modal-overlay fade-in">
          <div className="call-modal scale-in">
            <div className="call-modal-icon pulse-circle">
              <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="23 7 16 12 23 17 23 7"></polygon>
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
              </svg>
            </div>
            <h3>Incoming Video Call</h3>
            <p><strong>{callerName}</strong> is calling you...</p>
            <div className="call-actions">
              <button className="accept-btn" onClick={answerCall}>Accept</button>
              <button className="decline-btn" onClick={leaveCall}>Decline</button>
            </div>
          </div>
        </div>
      )}

      {/* Active Call UI */}
      {(stream || callAccepted) && (
        <div className="active-call-overlay fade-in">
          <div className="video-container">
            <div className="remote-video-wrapper">
              <video playsInline ref={remoteVideo} autoPlay className="remote-video" style={{ display: callAccepted && !callEnded ? 'block' : 'none' }} />
              {!(callAccepted && !callEnded) && (
                <div className="calling-placeholder">
                  <div className="dots">
                    <span></span><span></span><span></span>
                  </div>
                  <p>{receivingCall ? "Connecting..." : "Calling..."}</p>
                </div>
              )}
            </div>
            {stream && (
              <div className="local-video-wrapper">
                <video playsInline muted ref={localVideo} autoPlay className="local-video" />
              </div>
            )}
            <div className="call-controls">
              <button className="hangup-btn" onClick={leaveCall}>
                <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
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
