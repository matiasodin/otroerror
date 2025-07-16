const express = require("express")
const http = require("http")
const WebSocket = require("ws")
const path = require("path")

class MinecraftVoiceChatServer {
  constructor() {
    this.app = express()
    this.server = http.createServer(this.app)
    this.wss = new WebSocket.Server({ server: this.server })
    this.rooms = new Map() // Map<roomCode, { code, owner, players: Map<gameTag, client>, bannedPlayers: Set<gameTag>, settings, lastActivity, isClosed }>
    this.clients = new Map() // Map<ws, clientObject>

    this.setupExpress()
    this.setupWebSocket()
    this.startRoomCleanup() // Iniciar el proceso de limpieza de salas
  }

  setupExpress() {
    // Servir archivos estáticos
    this.app.use(express.static(path.join(__dirname)))

    // Ruta principal
    this.app.get("/", (req, res) => {
      res.sendFile(path.join(__dirname, "index.html"))
    })

    // API para estadísticas
    this.app.get("/api/stats", (req, res) => {
      res.json({
        totalRooms: this.rooms.size,
        totalClients: this.clients.size,
        rooms: Array.from(this.rooms.entries()).map(([code, room]) => ({
          code,
          players: room.players.size,
          bannedPlayers: Array.from(room.bannedPlayers),
          created: room.created,
          lastActivity: room.lastActivity,
          maxPlayers: room.settings.maxPlayers,
          isClosed: room.isClosed, // Incluir estado de cierre
        })),
      })
    })
  }

  setupWebSocket() {
    this.wss.on("connection", (ws) => {
      console.log("New client connected")

      ws.on("message", (data) => {
        try {
          const message = JSON.parse(data)
          this.handleMessage(ws, message)
        } catch (error) {
          console.error("Error parsing message:", error)
        }
      })

      ws.on("close", () => {
        this.handleDisconnect(ws)
      })

      ws.on("error", (error) => {
        console.error("WebSocket error:", error)
      })
    })
  }

  handleMessage(ws, message) {
    // Actualizar la actividad de la sala en cada mensaje recibido
    const client = this.clients.get(ws)
    if (client && client.roomCode) {
      const room = this.rooms.get(client.roomCode)
      if (room) {
        room.lastActivity = Date.now()
      }
    }

    switch (message.type) {
      case "join_room":
        this.handleJoinRoom(ws, message)
        break
      case "create_room":
        this.handleCreateRoom(ws, message)
        break
      case "leave_room":
        this.handleLeaveRoom(ws, message)
        break
      case "audio_data":
        this.handleAudioData(ws, message)
        break
      case "position_update":
        this.handlePositionUpdate(ws, message)
        break
      case "voice_activity":
        this.handleVoiceActivity(ws, message)
        break
      case "admin_mute_all":
        this.handleAdminMuteAll(ws, message)
        break
      case "admin_speak_all":
        this.handleAdminSpeakAll(ws, message)
        break
      case "close_room": // Modificado: Ahora solo marca la sala como cerrada para nuevas entradas
        this.handleCloseRoom(ws, message)
        break
      case "translation_request":
        this.handleTranslationRequest(ws, message)
        break
      case "tts_message":
        this.handleTtsMessage(ws, message)
        break
      case "kick_player":
        this.handleKickPlayer(ws, message)
        break
      case "unban_player":
        this.handleUnbanPlayer(ws, message)
        break
      default:
        console.log("Unknown message type:", message.type)
    }
  }

  handleCreateRoom(ws, message) {
    const { roomCode, gameTag, language, maxPlayers } = message

    if (this.rooms.has(roomCode)) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Room already exists",
        }),
      )
      return
    }

    if (this.isGameTagInUseInRoom(roomCode, gameTag)) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Game Tag already in use in this room. Please choose a different one.",
        }),
      )
      return
    }

    const room = {
      code: roomCode,
      owner: gameTag,
      players: new Map(),
      bannedPlayers: new Set(),
      created: new Date(),
      lastActivity: Date.now(),
      isClosed: false, // Nuevo: La sala no está cerrada por defecto
      settings: {
        maxPlayers: maxPlayers || 50,
        proximityRadius: 50,
        allowTranslation: true,
      },
    }

    const client = {
      ws,
      gameTag,
      language,
      roomCode,
      position: { x: 0, y: 64, z: 0 },
      dimension: "overworld",
      isAdmin: true,
      isMuted: false,
      isDeaf: false,
      joinedAt: new Date(),
    }

    this.rooms.set(roomCode, room)
    this.clients.set(ws, client)
    room.players.set(gameTag, client)

    ws.send(
      JSON.stringify({
        type: "room_created",
        roomCode,
        isAdmin: true,
        players: [],
        bannedPlayers: [],
        isClosed: room.isClosed, // Enviar estado de cierre
      }),
    )

    console.log(`Room ${roomCode} created by ${gameTag} with max players ${room.settings.maxPlayers}`)
  }

  handleJoinRoom(ws, message) {
    const { roomCode, gameTag, language } = message

    if (!this.rooms.has(roomCode)) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Room not found",
        }),
      )
      return
    }

    const room = this.rooms.get(roomCode)

    // Nuevo: Verificar si la sala está cerrada para nuevas entradas
    if (room.isClosed) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "This room is closed for new joins.",
        }),
      )
      console.log(`${gameTag} tried to join closed room ${roomCode}.`)
      return
    }

    if (this.isGameTagInUseInRoom(roomCode, gameTag)) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Game Tag already in use in this room. Please choose a different one.",
        }),
      )
      return
    }

    if (room.bannedPlayers.has(gameTag)) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "You are banned from this room.",
        }),
      )
      console.log(`${gameTag} tried to join room ${roomCode} but is banned.`)
      return
    }

    if (room.players.size >= room.settings.maxPlayers) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Room is full",
        }),
      )
      console.log(`${gameTag} tried to join full room ${roomCode}. Max players: ${room.settings.maxPlayers}`)
      return
    }

    const client = {
      ws,
      gameTag,
      language,
      roomCode,
      position: { x: 0, y: 64, z: 0 },
      dimension: "overworld",
      isAdmin: false,
      isMuted: false,
      isDeaf: false,
      joinedAt: new Date(),
    }

    this.clients.set(ws, client)
    room.players.set(gameTag, client)
    room.lastActivity = Date.now()

    ws.send(
      JSON.stringify({
        type: "joined_room",
        roomCode,
        isAdmin: false,
        players: Array.from(room.players.values()).map((p) => ({
          gameTag: p.gameTag,
          language: p.language,
          position: p.position,
          dimension: p.dimension,
          isAdmin: p.isAdmin,
        })),
        bannedPlayers: Array.from(room.bannedPlayers),
        isClosed: room.isClosed, // Enviar estado de cierre
      }),
    )

    this.broadcastToRoom(
      roomCode,
      {
        type: "player_joined",
        player: {
          gameTag,
          language,
          position: client.position,
          dimension: client.dimension,
          isAdmin: false,
        },
      },
      ws,
    )

    console.log(`${gameTag} joined room ${roomCode}. Current players: ${room.players.size}/${room.settings.maxPlayers}`)
  }

  handleLeaveRoom(ws, message) {
    const client = this.clients.get(ws)
    if (!client) return

    const room = this.rooms.get(client.roomCode)
    if (room) {
      room.players.delete(client.gameTag)
      room.lastActivity = Date.now()

      this.broadcastToRoom(
        client.roomCode,
        {
          type: "player_left",
          gameTag: client.gameTag,
        },
        ws,
      )

      if (room.owner === client.gameTag && room.players.size > 0) {
        const newOwner = room.players.values().next().value
        room.owner = newOwner.gameTag
        newOwner.isAdmin = true

        newOwner.ws.send(
          JSON.stringify({
            type: "admin_promoted",
            message: "You are now the room admin",
          }),
        )
      }

      if (room.players.size === 0) {
        console.log(`Room ${client.roomCode} is now empty. Will be subject to automatic cleanup if inactive.`)
      }
    }

    this.clients.delete(ws)
    console.log(`${client.gameTag} left room ${client.roomCode}`)
  }

  async handleAudioData(ws, message) {
    const client = this.clients.get(ws)
    if (!client || client.isMuted) return

    const room = this.rooms.get(client.roomCode)
    if (!room) return

    room.lastActivity = Date.now()

    const { audioData, position, dimension } = message

    client.position = position
    client.dimension = dimension

    const originalText = `(Simulated Speech from ${client.gameTag} in ${client.language})`

    room.players.forEach(async (targetClient, targetGameTag) => {
      if (targetGameTag === client.gameTag || targetClient.isDeaf) return

      if (targetClient.dimension !== dimension) return

      const distance = this.calculateDistance(position, targetClient.position)

      if (distance <= room.settings.proximityRadius || client.speakToAll) {
        if (room.settings.allowTranslation && client.language !== targetClient.language) {
          const translatedText = await this.simulateTranslation(originalText, client.language, targetClient.language)

          const simulatedTTSAudio = await this.simulateTTS(translatedText, targetClient.language)
          simulatedTTSAudio.text = translatedText
          simulatedTTSAudio.speaker = client.gameTag
          simulatedTTSAudio.language = targetClient.language
          simulatedTTSAudio.isAI = true

          targetClient.ws.send(
            JSON.stringify({
              type: "translated_audio_data",
              gameTag: client.gameTag,
              audioData: simulatedTTSAudio,
              originalText: originalText,
              translatedText: translatedText,
              position,
              dimension,
              distance,
            }),
          )

          this.sendAddonCommand(targetClient.gameTag, "show_translated_bubble", {
            speaker: client.gameTag,
            original: originalText,
            translated: translatedText,
          })
        } else {
          targetClient.ws.send(
            JSON.stringify({
              type: "audio_data",
              gameTag: client.gameTag,
              audioData,
              position,
              dimension,
              distance,
            }),
          )
        }
      }
    })
  }

  async simulateTranslation(text, fromLang, toLang) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    return `[${toLang.toUpperCase()}] ${text}`
  }

  async simulateTTS(text, language) {
    await new Promise((resolve) => setTimeout(resolve, 150))
    return {
      data: `Simulated audio for: "${text}" in ${language}`,
      format: "mp3",
    }
  }

  handlePositionUpdate(ws, message) {
    const client = this.clients.get(ws)
    if (!client) return

    const room = this.rooms.get(client.roomCode)
    if (room) {
      room.lastActivity = Date.now()
    }

    const { position, dimension } = message
    client.position = position
    client.dimension = dimension

    this.broadcastToRoom(
      client.roomCode,
      {
        type: "position_update",
        gameTag: client.gameTag,
        position,
        dimension,
      },
      ws,
    )
  }

  handleVoiceActivity(ws, message) {
    const client = this.clients.get(ws)
    if (!client) return

    const room = this.rooms.get(client.roomCode)
    if (room) {
      room.lastActivity = Date.now()
    }

    const { active } = message

    this.broadcastToRoom(
      client.roomCode,
      {
        type: "voice_activity",
        gameTag: client.gameTag,
        active: active,
      },
      ws,
    )

    this.sendAddonCommand(client.gameTag, "player_speaking_status", { active: active })

    console.log(`Voice activity from ${client.gameTag}: ${active}`)
  }

  handleAdminMuteAll(ws, message) {
    const client = this.clients.get(ws)
    if (!client || !client.isAdmin) return

    const room = this.rooms.get(client.roomCode)
    if (!room) return

    room.lastActivity = Date.now()

    room.players.forEach((targetClient, targetGameTag) => {
      if (targetGameTag !== client.gameTag) {
        targetClient.isMuted = true
        targetClient.ws.send(
          JSON.stringify({
            type: "admin_muted",
            message: "You have been muted by admin",
          }),
        )
      }
    })

    console.log(`${client.gameTag} muted all players in room ${client.roomCode}`)
  }

  handleAdminSpeakAll(ws, message) {
    const client = this.clients.get(ws)
    if (!client || !client.isAdmin) return

    const room = this.rooms.get(client.roomCode)
    if (room) {
      room.lastActivity = Date.now()
    }

    client.speakToAll = !client.speakToAll

    ws.send(
      JSON.stringify({
        type: "speak_all_toggled",
        enabled: client.speakToAll,
      }),
    )

    console.log(`${client.gameTag} toggled speak-to-all: ${client.speakToAll}`)
  }

  // MODIFICADO: Ahora solo marca la sala como cerrada para nuevas entradas
  handleCloseRoom(ws, message) {
    const adminClient = this.clients.get(ws)
    if (!adminClient || !adminClient.isAdmin) {
      ws.send(JSON.stringify({ type: "error", message: "Permission denied." }))
      return
    }

    const room = this.rooms.get(adminClient.roomCode)
    if (!room) {
      ws.send(JSON.stringify({ type: "error", message: "Room not found." }))
      return
    }

    room.isClosed = true // Marcar la sala como cerrada
    room.lastActivity = Date.now() // Actualizar actividad

    // Notificar a todos los jugadores en la sala que la sala está cerrada para nuevas entradas
    this.broadcastToRoom(adminClient.roomCode, {
      type: "room_status_update", // Nuevo tipo de mensaje
      roomCode: adminClient.roomCode,
      isClosed: true,
      message: "This room is now closed for new joins.",
    })

    console.log(`Room ${adminClient.roomCode} closed for new joins by ${adminClient.gameTag}.`)
    ws.send(JSON.stringify({ type: "success", message: "Room closed for new joins." }))
  }

  handleTranslationRequest(ws, message) {
    const client = this.clients.get(ws)
    if (!client) return

    const room = this.rooms.get(client.roomCode)
    if (room) {
      room.lastActivity = Date.now()
    }

    const { text, fromLang, toLang, targetPlayer } = message

    const translatedText = `[${toLang.toUpperCase()}] ${text}`

    if (targetPlayer) {
      const target = room?.players.get(targetPlayer)

      if (target) {
        target.ws.send(
          JSON.stringify({
            type: "translation",
            originalText: text,
            translatedText,
            fromPlayer: client.gameTag,
            fromLang,
            toLang,
          }),
        )
      }
    } else {
      ws.send(
        JSON.stringify({
          type: "translation",
          originalText: text,
          translatedText,
          fromLang,
          toLang,
        }),
      )
    }
  }

  async handleTtsMessage(ws, message) {
    const client = this.clients.get(ws)
    if (!client) return

    const room = this.rooms.get(client.roomCode)
    if (room) {
      room.lastActivity = Date.now()
    }

    const { text, language } = message

    console.log(`[SERVER] TTS request from ${client.gameTag}: "${text}"`)

    const simulatedAudioData = await this.simulateTTS(text, language)
    simulatedAudioData.speaker = client.gameTag
    simulatedAudioData.language = language
    simulatedAudioData.isOccultistVoice = true

    if (!room) return

    room.players.forEach(async (targetClient, targetGameTag) => {
      if (targetClient.isDeaf) return

      if (targetClient.dimension !== client.dimension) return

      const distance = this.calculateDistance(client.position, targetClient.position)
      if (distance <= room.settings.proximityRadius || client.speakToAll) {
        let finalTranslatedText = text
        if (language !== targetClient.language && room.settings.allowTranslation) {
          finalTranslatedText = await this.simulateTranslation(text, language, targetClient.language)
        }

        targetClient.ws.send(
          JSON.stringify({
            type: "tts_audio",
            gameTag: client.gameTag,
            audioData: simulatedAudioData,
            translatedText: finalTranslatedText,
            position: client.position,
            dimension: client.dimension,
            distance: distance,
          }),
        )

        if (language !== targetClient.language && room.settings.allowTranslation) {
          this.sendAddonCommand(targetClient.gameTag, "show_translated_bubble", {
            speaker: client.gameTag,
            original: text,
            translated: finalTranslatedText,
          })
        }
      }
    })
  }

  handleKickPlayer(ws, message) {
    const adminClient = this.clients.get(ws)
    if (!adminClient || !adminClient.isAdmin) {
      ws.send(JSON.stringify({ type: "error", message: "Permission denied." }))
      return
    }

    const { roomCode, targetGameTag } = message
    const room = this.rooms.get(roomCode)

    if (!room) {
      ws.send(JSON.stringify({ type: "error", message: "Room not found." }))
      return
    }

    room.lastActivity = Date.now()

    const targetClient = Array.from(room.players.values()).find((p) => p.gameTag === targetGameTag)

    if (!targetClient) {
      ws.send(JSON.stringify({ type: "error", message: "Player not found in room." }))
      return
    }

    if (targetClient.isAdmin) {
      ws.send(JSON.stringify({ type: "error", message: "Cannot kick another admin." }))
      return
    }

    room.bannedPlayers.add(targetGameTag)
    console.log(`${targetGameTag} has been banned from room ${roomCode}.`)

    targetClient.ws.send(
      JSON.stringify({
        type: "kicked_from_room",
        message: `You were kicked by ${adminClient.gameTag}.`,
      }),
    )
    targetClient.ws.close()

    room.players.delete(targetGameTag)
    this.clients.delete(targetClient.ws)

    this.broadcastToRoom(roomCode, {
      type: "player_left",
      gameTag: targetGameTag,
    })
    this.broadcastToRoom(roomCode, {
      type: "player_banned",
      gameTag: targetGameTag,
    })

    console.log(`${targetGameTag} kicked from room ${roomCode} by ${adminClient.gameTag}.`)
  }

  handleUnbanPlayer(ws, message) {
    const adminClient = this.clients.get(ws)
    if (!adminClient || !adminClient.isAdmin) {
      ws.send(JSON.stringify({ type: "error", message: "Permission denied." }))
      return
    }

    const { roomCode, targetGameTag } = message
    const room = this.rooms.get(roomCode)

    if (!room) {
      ws.send(JSON.stringify({ type: "error", message: "Room not found." }))
      return
    }

    room.lastActivity = Date.now()

    if (!room.bannedPlayers.has(targetGameTag)) {
      ws.send(JSON.stringify({ type: "error", message: "Player is not banned." }))
      return
    }

    room.bannedPlayers.delete(targetGameTag)
    console.log(`${targetGameTag} has been unbanned from room ${roomCode}.`)

    this.broadcastToRoom(roomCode, {
      type: "player_unbanned",
      gameTag: targetGameTag,
    })

    ws.send(JSON.stringify({ type: "success", message: `${targetGameTag} unbanned.` }))
  }

  handleDisconnect(ws) {
    const client = this.clients.get(ws)
    if (client) {
      this.handleLeaveRoom(ws, { gameTag: client.gameTag })
    }
  }

  broadcastToRoom(roomCode, message, excludeWs = null) {
    const room = this.rooms.get(roomCode)
    if (!room) return

    const messageStr = JSON.stringify(message)

    room.players.forEach((client) => {
      if (client.ws !== excludeWs && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(messageStr)
      }
    })
  }

  calculateDistance(pos1, pos2) {
    const dx = pos1.x - pos2.x
    const dy = pos1.y - pos2.y
    const dz = pos1.z - pos2.z
    return Math.sqrt(dx * dx + dy * dy + dz * dz)
  }

  isGameTagInUseInRoom(roomCode, gameTag) {
    const room = this.rooms.get(roomCode)
    if (!room) return false
    return room.players.has(gameTag)
  }

  sendAddonCommand(gameTag, command, data) {
    console.log(`[SERVER -> ADDON SIMULATION] Sending command '${command}' for ${gameTag}:`, data)
  }

  startRoomCleanup() {
    const cleanupInterval = 3600000 // 1 hora
    const inactivityThreshold = 3 * 24 * 60 * 60 * 1000 // 3 días en milisegundos

    setInterval(() => {
      const now = Date.now()
      console.log(`[SERVER] Running room cleanup. Current rooms: ${this.rooms.size}`)

      this.rooms.forEach((room, roomCode) => {
        // Solo cerrar si la sala está vacía Y ha estado inactiva por más de 3 días
        if (room.players.size === 0 && now - room.lastActivity > inactivityThreshold) {
          this.closeInactiveRoom(roomCode)
        }
      })
    }, cleanupInterval)
  }

  closeInactiveRoom(roomCode) {
    if (this.rooms.has(roomCode)) {
      this.rooms.delete(roomCode)
      console.log(`[SERVER] Automatically closed inactive room: ${roomCode}`)
    }
  }

  start(port = 3000) {
    this.server.listen(port, () => {
      console.log(`Minecraft Voice Chat Server running on port ${port}`)
      console.log(`Open http://localhost:${port} to access the client`)
    })
  }
}

// Iniciar servidor
const server = new MinecraftVoiceChatServer()
server.start(process.env.PORT || 3000)

module.exports = MinecraftVoiceChatServer
