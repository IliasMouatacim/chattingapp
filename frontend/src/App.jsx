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
  const listRef = useRef(null)

  useEffect(() => {
    socket.connect()

    const onMessage = (message) => {
      setMessages((prev) => [...prev, message])
    }

    socket.on('chat_message', onMessage)

    return () => {
      socket.off('chat_message', onMessage)
      socket.disconnect()
    }
  }, [socket])

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages])

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

  const sendMessage = (event) => {
    event.preventDefault()
    const message = draft.trim()
    if (!message || !joined) {
      return
    }
    socket.emit('send_message', message)
    setDraft('')
  }

  return (
    <main className="chat-page">
      <section className="chat-shell">
        <header className="chat-header">
          <h1>Live Room</h1>
          <p>{joined ? `Connected as ${name}` : 'Pick a name to join the room'}</p>
        </header>

        {!joined && (
          <form className="join-form" onSubmit={joinRoom}>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your name"
              maxLength={24}
            />
            <button type="submit">Join chat</button>
          </form>
        )}

        <div className="messages" ref={listRef}>
          {messages.map((msg) => (
            <article key={msg.id} className={`message ${msg.user === 'system' ? 'system' : ''}`}>
              <div className="meta">
                <strong>{msg.user}</strong>
                <time>{new Date(msg.timestamp).toLocaleTimeString()}</time>
              </div>
              <p>{msg.text}</p>
            </article>
          ))}
        </div>

        <form className="composer" onSubmit={sendMessage}>
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={joined ? 'Type your message...' : 'Join first to send messages'}
            maxLength={500}
            disabled={!joined}
          />
          <button type="submit" disabled={!joined}>Send</button>
        </form>
      </section>
    </main>
  )
}

export default App
