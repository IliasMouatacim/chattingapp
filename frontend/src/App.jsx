import { useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import './App.css'

function App() {
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000'
  const socket = useMemo(() => io(apiUrl, { autoConnect: false }), [apiUrl])
  
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
  
  const listRef = useRef(null)
  const typingTimeoutRef = useRef(null)
  const isTypingRef = useRef(false)
  const activeChatRef = useRef('global')

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
      
      setMessages((prev) => ({ ...prev, [chatId]: [...(prev[chatId] || []), message] }))
      
      if (activeChatRef.current !== chatId) {
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

    socket.on('chat_message', onMessage)
    socket.on('private_message', onPrivateMessage)
    socket.on('room_message', onRoomMessage)
    socket.on('online_users', onOnlineUsers)
    socket.on('user_typing', onUserTyping)
    socket.on('user_stop_typing', onUserStopTyping)

    return () => {
      socket.off('chat_message', onMessage)
      socket.off('private_message', onPrivateMessage)
      socket.off('room_message', onRoomMessage)
      socket.off('online_users', onOnlineUsers)
      socket.off('user_typing', onUserTyping)
      socket.off('user_stop_typing', onUserStopTyping)
      socket.disconnect()
    }
  }, [socket])

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages, typingUsers, activeChat])

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
          <h2>Orbit</h2>
          <span className="online-badge">{onlineUsers.length} Online</span>
        </div>
        <div className="user-list">
          <div 
            className={`user-item ${activeChat === 'global' ? 'active' : ''}`}
            onClick={() => setActiveChat('global')}
            style={{ cursor: 'pointer' }}
          >
            <span className="status-dot global"></span>
            Global Room
            {unread.global > 0 && <span className="unread-badge">{unread.global}</span>}
          </div>
          <div className="sidebar-spacer" style={{ margin: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.1)' }}></div>
          
          <form className="join-room-form" onSubmit={joinPrivateRoom}>
            <input 
              type="text" 
              placeholder="Enter room code" 
              value={roomCodeInput}
              onChange={(e) => setRoomCodeInput(e.target.value)}
              className="room-input"
            />
            <button type="submit" className="room-btn">+</button>
          </form>

          {joinedRooms.map(room => (
            <div 
              key={room} 
              className={`user-item room-item ${activeChat === `room_${room}` ? 'active' : ''}`}
              onClick={() => setActiveChat(`room_${room}`)}
              style={{ cursor: 'pointer' }}
            >
              <span className="room-hash">#</span>
              {room}
              {unread[`room_${room}`] > 0 && <span className="unread-badge">{unread[`room_${room}`]}</span>}
            </div>
          ))}

          <div className="sidebar-spacer" style={{ margin: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.1)' }}></div>
          
          {onlineUsers.map(u => (
            <div 
              key={u.id} 
              className={`user-item ${activeChat === u.id ? 'active' : ''} ${u.id === socket.id ? 'disabled' : ''}`}
              onClick={() => { if (u.id !== socket.id) setActiveChat(u.id) }}
              style={{ cursor: u.id === socket.id ? 'default' : 'pointer' }}
            >
              <span className="status-dot online"></span>
              {u.name}
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
    </main>
  )
}

export default App
