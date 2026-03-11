import { useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import './App.css'

function App() {
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000'
  const socket = useMemo(() => io(apiUrl, { autoConnect: false }), [apiUrl])
  
  const [name, setName] = useState('')
  const [joined, setJoined] = useState(false)
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  
  // New state
  const [onlineUsers, setOnlineUsers] = useState([])
  const [typingUsers, setTypingUsers] = useState(new Set())
  
  const listRef = useRef(null)
  const typingTimeoutRef = useRef(null)
  const isTypingRef = useRef(false)

  useEffect(() => {
    socket.connect()

    const onMessage = (message) => {
      setMessages((prev) => [...prev, message])
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
    socket.on('online_users', onOnlineUsers)
    socket.on('user_typing', onUserTyping)
    socket.on('user_stop_typing', onUserStopTyping)

    return () => {
      socket.off('chat_message', onMessage)
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
  }, [messages, typingUsers])

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

    socket.emit('send_message', message)
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
          {onlineUsers.map(u => (
            <div key={u.id} className="user-item">
              <span className="status-dot online"></span>
              {u.name}
              {u.name === name && <span className="you-tag">(You)</span>}
            </div>
          ))}
        </div>
      </aside>
      
      <section className="chat-container">
        <header className="chat-header">
          <div className="header-info">
            <h2>Global Room</h2>
            <p>Connected as <strong>{name}</strong></p>
          </div>
        </header>

        <div className="messages-area">
          <div className="messages-scroll" ref={listRef}>
            {messages.map((msg) => {
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
