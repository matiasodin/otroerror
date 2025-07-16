class MinecraftVoiceChat {
  constructor() {
    this.socket = null
    this.audioContext = null
    this.mediaStream = null
    this.audioNodes = new Map() // Map<gameTag, { sourceNode, gainNode }>
    this.players = new Map() // Map<gameTag, playerObject>
    this.bannedPlayers = new Map() // Map<gameTag, { gameTag, bannedAt }>
    this.currentRoom = null
    this.currentUser = null
    this.isAdmin = false
    this.isMuted = false // Micrófono propio silenciado
    this.isDeaf = false // No escuchar a nadie
    this.isPushToTalk = false
    this.isConnected = false
    this.isRoomClosed = false // Nuevo: Estado de la sala (cerrada para nuevas entradas)
    this.translationService = null // Simulación de servicio de traducción

    // Actualiza la URL del WebSocket a ws://localhost:10000
    this.webSocketUrl = "wss://otroerror.onrender.com" // Usa 'wss' para HTTPS
    // Actualiza la URL de la página web a http://localhost:10000
    this.webUrl = "https://otroerror.onrender.com"

    this.init()
  }

  init() {
    this.setupEventListeners()
    this.initializeAudioContext()
    this.setupTranslationService()
  }

  setupEventListeners() {
    // Botones de conexión
    document.getElementById("joinRoom").addEventListener("click", () => this.joinRoom())
    document.getElementById("createRoom").addEventListener("click", () => this.createRoom())

    // Controles de audio
    document.getElementById("micToggle").addEventListener("click", () => this.toggleMic())
    document.getElementById("deafToggle").addEventListener("click", () => this.toggleDeaf())
    document.getElementById("pushToTalk").addEventListener("click", () => this.togglePushToTalk())

    // Control de volumen
    document.getElementById("masterVolume").addEventListener("input", (e) => {
      this.setMasterVolume(e.target.value)
      document.getElementById("volumeValue").textContent = e.target.value + "%"
    })

    // Controles de admin
    document.getElementById("muteAll").addEventListener("click", () => this.muteAll())
    document.getElementById("speakToAll").addEventListener("click", () => this.speakToAll())
    document.getElementById("closeRoom").addEventListener("click", () => this.closeRoom())

    // Otros controles
    document.getElementById("copyRoomCode").addEventListener("click", () => this.copyRoomCode())
    document.getElementById("leaveRoom").addEventListener("click", () => this.leaveRoom())

    // Push to talk
    document.addEventListener("keydown", (e) => {
      if (e.code === "Space" && this.isPushToTalk && !this.isMuted) {
        e.preventDefault()
        this.startSpeaking()
      }
    })

    document.addEventListener("keyup", (e) => {
      if (e.code === "Space" && this.isPushToTalk) {
        e.preventDefault()
        this.stopSpeaking()
      }
    })
  }

  async initializeAudioContext() {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)()
      console.log("Audio context initialized")
    } catch (error) {
      console.error("Error initializing audio context:", error)
      this.showNotification("Error al inicializar el audio", "error")
    }
  }

  setupTranslationService() {
    // Simulación de servicio de traducción
    this.translationService = {
      translate: async (text, fromLang, toLang) => {
        // En una implementación real, aquí iría la llamada a la API de traducción
        await new Promise((resolve) => setTimeout(resolve, 500))
        return `[${toLang.toUpperCase()}] ${text}`
      },
    }
  }

  async createRoom() {
    const gameTag = document.getElementById("gameTag").value.trim()
    const language = document.getElementById("language").value
    const maxPlayers = Number.parseInt(document.getElementById("maxPlayers").value, 10)

    if (!gameTag) {
      this.showNotification("Por favor ingresa tu Game Tag", "error")
      return
    }
    if (isNaN(maxPlayers) || maxPlayers < 2 || maxPlayers > 200) {
      this.showNotification("Capacidad máxima inválida (2-200 jugadores)", "error")
      return
    }

    const roomCode = this.generateRoomCode()
    await this.connectToRoom(roomCode, gameTag, language, true, maxPlayers)
  }

  async joinRoom() {
    const gameTag = document.getElementById("gameTag").value.trim()
    const language = document.getElementById("language").value
    const roomCode = document.getElementById("roomCode").value.trim()

    if (!gameTag) {
      this.showNotification("Por favor ingresa tu Game Tag", "error")
      return
    }

    if (!roomCode) {
      this.showNotification("Por favor ingresa el código de sala", "error")
      return
    }

    await this.connectToRoom(roomCode, gameTag, language, false)
  }

  generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase()
  }

  async connectToRoom(roomCode, gameTag, language, isCreator, maxPlayers = 50) {
    try {
      this.showNotification("Conectando...", "info")

      // Solicitar permisos de micrófono
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })

      // Conectar WebSocket
      await this.connectWebSocket(roomCode, gameTag, language, isCreator, maxPlayers)

      this.currentUser = {
        gameTag,
        language,
        isAdmin: isCreator,
        position: { x: 0, y: 0, z: 0 },
        dimension: "overworld",
      }

      this.currentRoom = roomCode
      this.isAdmin = isCreator

      this.switchToChat()
      this.setupAudioProcessing()
    } catch (error) {
      console.error("Error connecting to room:", error)
      this.showNotification("Error al conectar: " + error.message, "error")
    }
  }

  async connectWebSocket(roomCode, gameTag, language, isCreator, maxPlayers) {
    return new Promise((resolve, reject) => {
      this.socket = new WebSocket(this.webSocketUrl)

      this.socket.onopen = () => {
        console.log("WebSocket connected.")
        const messageType = isCreator ? "create_room" : "join_room"
        const message = {
          type: messageType,
          roomCode,
          gameTag,
          language,
          maxPlayers: maxPlayers,
        }
        this.socket.send(JSON.stringify(message))
        resolve()
      }

      this.socket.onmessage = (event) => {
        const message = JSON.parse(event.data)
        console.log("Received:", message)
        switch (message.type) {
          case "joined_room":
          case "room_created":
            this.isConnected = true
            this.isAdmin = message.isAdmin
            this.currentRoom = message.roomCode
            this.isRoomClosed = message.isClosed // Nuevo: Actualizar estado de cierre de sala
            // Actualizar lista de jugadores inicial y lista de baneados
            this.players.clear()
            this.bannedPlayers.clear()
            message.players.forEach((p) => {
              if (p.gameTag !== this.currentUser.gameTag) {
                this.players.set(p.gameTag, p)
              }
            })
            if (message.bannedPlayers) {
              message.bannedPlayers.forEach((bannedTag) => {
                this.bannedPlayers.set(bannedTag, { gameTag: bannedTag })
              })
            }
            this.updatePlayersList()
            this.updateBannedPlayersList()
            this.showNotification(`Conectado a la sala ${message.roomCode}`, "success")
            break
          case "player_joined":
            this.handlePlayerJoined(message.player)
            break
          case "player_left":
            this.handlePlayerLeft(message.gameTag)
            break
          case "audio_data":
            this.handleIncomingAudio(message)
            break
          case "translated_audio_data":
            this.handleIncomingTranslatedAudio(message)
            break
          case "tts_audio":
            this.handleIncomingTTSAudio(message)
            break
          case "voice_activity":
            this.handleVoiceActivity(message.gameTag, message.active)
            break
          case "error":
            this.showNotification(`Error: ${message.message}`, "error")
            this.socket.close()
            reject(new Error(message.message))
            break
          case "admin_muted":
            this.showNotification(message.message, "warning")
            this.isMuted = true
            document.getElementById("micToggle").classList.remove("active")
            document.getElementById("micToggle").classList.add("muted")
            document.getElementById("micToggle").querySelector("i").className = "fas fa-microphone-slash"
            break
          case "speak_all_toggled":
            this.showNotification(`Modo hablar a todos: ${message.enabled ? "Activado" : "Desactivado"}`, "info")
            break
          case "room_closing": // Este mensaje ya no se usa para el cierre de admin, pero se mantiene por si acaso
            this.showNotification(message.message, "warning")
            this.leaveRoom()
            break
          case "kicked_from_room":
            this.showNotification(`Has sido expulsado de la sala: ${message.message}`, "error")
            this.leaveRoom()
            break
          case "player_banned":
            this.bannedPlayers.set(message.gameTag, { gameTag: message.gameTag })
            this.updateBannedPlayersList()
            this.showNotification(`${message.gameTag} ha sido expulsado.`, "warning")
            break
          case "player_unbanned":
            this.bannedPlayers.delete(message.gameTag)
            this.updateBannedPlayersList()
            this.showNotification(`${message.gameTag} puede volver a unirse.`, "info")
            break
          case "room_status_update": // Nuevo: Manejar actualización de estado de sala
            this.isRoomClosed = message.isClosed
            this.showNotification(message.message, "info")
            // Opcional: Actualizar UI para indicar que la sala está cerrada para nuevas entradas
            break
        }
      }

      this.socket.onclose = () => {
        console.log("WebSocket disconnected.")
        this.isConnected = false
        this.showNotification("Desconectado del servidor", "error")
        this.switchToConnection()
        this.resetState()
      }

      this.socket.onerror = (error) => {
        console.error("WebSocket error:", error)
        this.showNotification("Error de conexión WebSocket", "error")
        reject(error)
      }
    })
  }

  setupAudioProcessing() {
    if (!this.mediaStream || !this.audioContext) return

    const source = this.audioContext.createMediaStreamSource(this.mediaStream)
    const analyser = this.audioContext.createAnalyser()
    const gainNode = this.audioContext.createGain()

    source.connect(analyser)
    analyser.connect(gainNode)

    this.setupVoiceActivityDetection(analyser)
    this.startMicrophoneIndicator(analyser)
  }

  setupVoiceActivityDetection(analyser) {
    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)

    const checkVoiceActivity = () => {
      analyser.getByteFrequencyData(dataArray)

      const average = dataArray.reduce((a, b) => a + b) / bufferLength
      const isActive = average > 30 // Umbral de actividad de voz

      if (isActive && !this.isMuted) {
        this.handleVoiceActivity(true)
      } else {
        this.handleVoiceActivity(false)
      }

      requestAnimationFrame(checkVoiceActivity)
    }

    checkVoiceActivity()
  }

  startMicrophoneIndicator(analyser) {
    const indicator = document.getElementById("micIndicator")
    const level = indicator.querySelector(".mic-level")
    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)

    const updateIndicator = () => {
      if (this.isMuted) {
        indicator.classList.remove("active")
        return
      }

      analyser.getByteFrequencyData(dataArray)
      const average = dataArray.reduce((a, b) => a + b) / bufferLength

      if (average > 20) {
        indicator.classList.add("active")
        const scale = Math.min(1 + average / 100, 2)
        level.style.transform = `scale(${scale})`
      } else {
        indicator.classList.remove("active")
      }

      requestAnimationFrame(updateIndicator)
    }

    updateIndicator()
  }

  handleVoiceActivity(isActive) {
    const playerElement = document.querySelector(`[data-player="${this.currentUser.gameTag}"]`)
    if (playerElement) {
      if (isActive) {
        playerElement.classList.add("speaking")
      } else {
        playerElement.classList.remove("speaking")
      }
    }

    if (this.socket && this.socket.readyState === 1) {
      this.socket.send(
        JSON.stringify({
          type: "voice_activity",
          active: isActive,
          gameTag: this.currentUser.gameTag,
        }),
      )
    }
  }

  handlePlayerJoined(player) {
    this.players.set(player.gameTag, player)
    this.updatePlayersList()
    this.showNotification(`${player.gameTag} se unió a la sala`, "success")
    this.addChatMessage(`${player.gameTag} se conectó`, "system")
  }

  handlePlayerLeft(gameTag) {
    this.players.delete(gameTag)
    this.updatePlayersList()
    this.showNotification(`${gameTag} salió de la sala`, "warning")
    this.addChatMessage(`${gameTag} se desconectó`, "system")
  }

  updatePlayersList() {
    const playersList = document.getElementById("playersList")
    playersList.innerHTML = ""

    this.addPlayerToList(this.currentUser, true)

    this.players.forEach((player) => {
      this.addPlayerToList(player, false)
    })

    const totalPlayers = this.players.size + 1
    document.getElementById("playerCount").textContent = `${totalPlayers} jugador${totalPlayers !== 1 ? "es" : ""}`
  }

  updateBannedPlayersList() {
    const bannedPlayersPanel = document.getElementById("bannedPlayersPanel")
    const bannedPlayersList = document.getElementById("bannedPlayersList")
    bannedPlayersList.innerHTML = ""

    if (this.isAdmin && this.bannedPlayers.size > 0) {
      bannedPlayersPanel.classList.remove("hidden")
      this.bannedPlayers.forEach((bannedPlayer) => {
        this.addBannedPlayerToList(bannedPlayer)
      })
    } else {
      bannedPlayersPanel.classList.add("hidden")
    }
  }

  addPlayerToList(player, isCurrentUser) {
    const playersList = document.getElementById("playersList")
    const playerElement = document.createElement("div")
    playerElement.className = "player-item"
    playerElement.setAttribute("data-player", player.gameTag)

    const distance = this.calculateDistance(player.position, this.currentUser.position)
    const canHear = distance <= 50

    const avatarSrc = "/placeholder.svg?height=45&width=45"

    playerElement.innerHTML = `
        <div class="player-avatar">
            <img src="${avatarSrc}" alt="${player.gameTag.charAt(0).toUpperCase()}">
        </div>
        <div class="player-info">
            <div class="player-name">
                ${player.gameTag}
                ${player.isAdmin ? '<span class="admin-badge">ADMIN</span>' : ""}
                ${isCurrentUser ? '<span class="admin-badge" style="background: #17a2b8;">TÚ</span>' : ""}
            </div>
            <div class="player-status">
                <i class="fas fa-globe"></i>
                ${this.getLanguageName(player.language)}
                ${!canHear && !isCurrentUser ? '<i class="fas fa-volume-mute" title="Muy lejos"></i>' : ""}
                <span class="distance">${Math.round(distance)}m</span>
            </div>
        </div>
        <div class="player-controls">
            ${
              !isCurrentUser
                ? `
                <button onclick="voiceChat.togglePlayerMute('${player.gameTag}')" title="Mutear jugador">
                    <i class="fas fa-volume-mute"></i>
                </button>
                <button onclick="voiceChat.adjustPlayerVolume('${player.gameTag}')" title="Ajustar volumen">
                    <i class="fas fa-volume-up"></i>
                </button>
                ${
                  this.isAdmin
                    ? `<button onclick="voiceChat.kickPlayer('${player.gameTag}')" title="Expulsar jugador">
                    <i class="fas fa-ban"></i>
                </button>`
                    : ""
                }
            `
                : ""
            }
        </div>
    `

    if (!canHear && !isCurrentUser) {
      playerElement.classList.add("muted")
    }

    playersList.appendChild(playerElement)
  }

  addBannedPlayerToList(bannedPlayer) {
    const bannedPlayersList = document.getElementById("bannedPlayersList")
    const playerElement = document.createElement("div")
    playerElement.className = "player-item"
    playerElement.setAttribute("data-player", bannedPlayer.gameTag)

    const avatarSrc = "/placeholder.svg?height=45&width=45"

    playerElement.innerHTML = `
        <div class="player-avatar">
            <img src="${avatarSrc}" alt="${bannedPlayer.gameTag.charAt(0).toUpperCase()}">
        </div>
        <div class="player-info">
            <div class="player-name">
                ${bannedPlayer.gameTag}
            </div>
            <div class="player-status">
                <i class="fas fa-gavel"></i>
                Expulsado
            </div>
        </div>
        <div class="player-controls">
            <button onclick="voiceChat.unbanPlayer('${bannedPlayer.gameTag}')" title="Permitir unirse">
                <i class="fas fa-check"></i>
            </button>
        </div>
    `
    bannedPlayersList.appendChild(playerElement)
  }

  calculateDistance(pos1, pos2) {
    const dx = pos1.x - pos2.x
    const dy = pos1.y - pos2.y
    const dz = pos1.z - pos2.z
    return Math.sqrt(dx * dx + dy * dy + dz * dz)
  }

  getLanguageName(code) {
    const languages = {
      es: "Español",
      en: "English",
      pt: "Português",
      fr: "Français",
    }
    return languages[code] || code
  }

  async handleIncomingAudio(data) {
    const { gameTag, audioData, position, dimension } = data
    const player = this.players.get(gameTag)
    if (!player || this.isDeaf) return

    const distance = this.calculateDistance(position, this.currentUser.position)
    const volume = this.calculateVolumeByDistance(distance)
    if (volume <= 0) return

    const effects = this.getEnvironmentEffects(dimension, position)
    const processedAudio = await this.applyAudioEffects(audioData, effects, volume)
    this.playAudio(processedAudio)
    this.showSpeakingIndicator(gameTag)
  }

  async handleIncomingTranslatedAudio(data) {
    const { gameTag, audioData, originalText, translatedText, position, dimension } = data
    const player = this.players.get(gameTag)
    if (!player || this.isDeaf) return

    const distance = this.calculateDistance(position, this.currentUser.position)
    const volume = this.calculateVolumeByDistance(distance)
    if (volume <= 0) return

    const effects = this.getEnvironmentEffects(dimension, position)
    const processedAudio = {
      ...audioData,
      volume: volume * (document.getElementById("masterVolume").value / 100),
      isOccultistVoice: true,
    }
    this.playSimulatedTTSAudio(processedAudio)
    this.showSpeakingIndicator(gameTag)
    this.showTranslationBubble(originalText, translatedText)
  }

  async handleIncomingTTSAudio(data) {
    const { gameTag, audioData, translatedText, position, dimension } = data
    const player = this.players.get(gameTag)
    if (!player || this.isDeaf) return

    const distance = this.calculateDistance(position, this.currentUser.position)
    const volume = this.calculateVolumeByDistance(distance)
    if (volume <= 0) return

    const effects = this.getEnvironmentEffects(dimension, position)
    const processedAudio = {
      ...audioData,
      volume: volume * (document.getElementById("masterVolume").value / 100),
      isOccultistVoice: audioData.isOccultistVoice,
    }
    this.playSimulatedTTSAudio(processedAudio)
    this.showSpeakingIndicator(gameTag)
    this.showTranslationBubble(audioData.text, translatedText)
  }

  calculateVolumeByDistance(distance) {
    const maxDistance = 50
    if (distance >= maxDistance) return 0
    return Math.max(0, 1 - distance / maxDistance)
  }

  getEnvironmentEffects(dimension, position) {
    const effects = {
      reverb: 0,
      echo: 0,
      distortion: 0,
      lowpass: 1,
    }

    switch (dimension) {
      case "nether":
        effects.distortion = 0.3
        effects.lowpass = 0.7
        break
      case "end":
        effects.reverb = 0.8
        effects.echo = 0.5
        break
      case "overworld":
        if (position.y < 40) {
          effects.reverb = 0.6
          effects.echo = 0.3
        }
        break
    }
    return effects
  }

  async applyAudioEffects(audioData, effects, volume) {
    if (!this.audioContext) return audioData
    return {
      ...audioData,
      volume: volume * (document.getElementById("masterVolume").value / 100),
    }
  }

  playAudio(audioData) {
    console.log("Playing original audio:", audioData)
  }

  playSimulatedTTSAudio(audioData) {
    console.log(
      `[TTS SIMULADO] Reproduciendo voz de ${audioData.speaker}: "${audioData.text}" (Volumen: ${audioData.volume.toFixed(2)})`,
    )
    if (audioData.isOccultistVoice) {
      console.log("  (Aplicando efecto de voz 'ocultista' simulado)")
    }
  }

  showSpeakingIndicator(gameTag) {
    const playerElement = document.querySelector(`[data-player="${gameTag}"]`)
    if (playerElement) {
      playerElement.classList.add("speaking")
      setTimeout(() => {
        playerElement.classList.remove("speaking")
      }, 1000)
    }
  }

  showTranslationBubble(originalText, translatedText) {
    const bubble = document.getElementById("translationBubble")
    bubble.querySelector(".original-text").textContent = originalText
    bubble.querySelector(".translated-text").textContent = translatedText
    bubble.classList.remove("hidden")

    setTimeout(() => {
      bubble.classList.add("hidden")
    }, 4000)

    this.addChatMessage(`${originalText} → ${translatedText}`, "translation")
  }

  toggleMic() {
    this.isMuted = !this.isMuted
    const button = document.getElementById("micToggle")
    const icon = button.querySelector("i")

    if (this.isMuted) {
      button.classList.remove("active")
      button.classList.add("muted")
      icon.className = "fas fa-microphone-slash"
      this.showNotification("Micrófono silenciado", "warning")
    } else {
      button.classList.add("active")
      button.classList.remove("muted")
      icon.className = "fas fa-microphone"
      this.showNotification("Micrófono activado", "success")
    }

    if (this.mediaStream) {
      this.mediaStream.getAudioTracks().forEach((track) => {
        track.enabled = !this.isMuted
      })
    }
  }

  toggleDeaf() {
    this.isDeaf = !this.isDeaf
    const button = document.getElementById("deafToggle")
    const icon = button.querySelector("i")

    if (this.isDeaf) {
      button.classList.add("active")
      icon.className = "fas fa-volume-mute"
      this.showNotification("Audio silenciado", "warning")
    } else {
      button.classList.remove("active")
      icon.className = "fas fa-volume-up"
      this.showNotification("Audio activado", "success")
    }
  }

  togglePushToTalk() {
    this.isPushToTalk = !this.isPushToTalk
    const button = document.getElementById("pushToTalk")

    if (this.isPushToTalk) {
      button.classList.add("active")
      this.showNotification("Modo pulsar para hablar activado (Espacio)", "info")
    } else {
      button.classList.remove("active")
      this.showNotification("Modo pulsar para hablar desactivado", "info")
    }
  }

  setMasterVolume(volume) {
    this.audioNodes.forEach((node) => {
      if (node.gainNode) {
        node.gainNode.gain.value = volume / 100
      }
    })
  }

  startSpeaking() {
    if (this.isMuted) return
    console.log("Started speaking")
  }

  stopSpeaking() {
    console.log("Stopped speaking")
  }

  muteAll() {
    if (!this.isAdmin) return

    this.socket.send(
      JSON.stringify({
        type: "admin_mute_all",
        gameTag: this.currentUser.gameTag,
      }),
    )

    this.showNotification("Todos los jugadores han sido silenciados", "info")
  }

  speakToAll() {
    if (!this.isAdmin) return

    this.socket.send(
      JSON.stringify({
        type: "admin_speak_all",
        gameTag: this.currentUser.gameTag,
      }),
    )

    this.showNotification("Modo hablar a todos activado", "info")
  }

  closeRoom() {
    if (!this.isAdmin) return

    if (
      confirm(
        "¿Estás seguro de que quieres cerrar la sala para nuevas entradas? Los jugadores actuales NO serán expulsados.",
      )
    ) {
      this.socket.send(
        JSON.stringify({
          type: "close_room",
          gameTag: this.currentUser.gameTag,
        }),
      )
      // No se llama a leaveRoom() aquí, ya que el admin no se desconecta automáticamente.
    }
  }

  copyRoomCode() {
    navigator.clipboard.writeText(this.currentRoom).then(() => {
      this.showNotification("Código copiado al portapapeles", "success")
    })
  }

  leaveRoom() {
    if (this.socket) {
      this.socket.send(
        JSON.stringify({
          type: "leave_room",
          gameTag: this.currentUser.gameTag,
        }),
      )
      this.socket.close()
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop())
    }

    this.switchToConnection()
    this.resetState()
  }

  switchToChat() {
    document.getElementById("connectionScreen").classList.remove("active")
    document.getElementById("chatScreen").classList.add("active")

    document.getElementById("currentRoomCode").textContent = this.currentRoom
    document.getElementById("connectionStatus").textContent = "Conectado"
    document.getElementById("connectionStatus").className = "status connected"

    if (this.isAdmin) {
      document.getElementById("adminControls").classList.remove("hidden")
      document.getElementById("bannedPlayersPanel").classList.remove("hidden")
    } else {
      document.getElementById("adminControls").classList.add("hidden")
      document.getElementById("bannedPlayersPanel").classList.add("hidden")
    }

    this.updatePlayersList()
    this.updateBannedPlayersList()
  }

  switchToConnection() {
    document.getElementById("chatScreen").classList.remove("active")
    document.getElementById("connectionScreen").classList.add("active")
  }

  resetState() {
    this.socket = null
    this.mediaStream = null
    this.players.clear()
    this.bannedPlayers.clear()
    this.currentRoom = null
    this.currentUser = null
    this.isAdmin = false
    this.isMuted = false
    this.isDeaf = false
    this.isPushToTalk = false
    this.isConnected = false
    this.isRoomClosed = false // Resetear estado de cierre

    document.getElementById("adminControls").classList.add("hidden")
    document.getElementById("bannedPlayersPanel").classList.add("hidden")
    document.getElementById("playersList").innerHTML = ""
    document.getElementById("bannedPlayersList").innerHTML = ""
    document.getElementById("chatMessages").innerHTML = ""
  }

  addChatMessage(message, type = "system") {
    const messagesContainer = document.getElementById("chatMessages")
    const messageElement = document.createElement("div")
    messageElement.className = `message ${type}`
    messageElement.textContent = message

    messagesContainer.appendChild(messageElement)
    messagesContainer.scrollTop = messagesContainer.scrollHeight
  }

  showNotification(message, type = "info") {
    const notifications = document.getElementById("notifications")
    const notification = document.createElement("div")
    notification.className = `notification ${type}`
    notification.textContent = message

    notifications.appendChild(notification)

    setTimeout(() => {
      notification.remove()
    }, 4000)
  }

  togglePlayerMute(gameTag) {
    const player = this.players.get(gameTag)
    if (player) {
      player.muted = !player.muted
      this.updatePlayersList()
      this.showNotification(`${gameTag} ${player.muted ? "silenciado" : "activado"}`, "info")
    }
  }

  adjustPlayerVolume(gameTag) {
    console.log("Adjusting volume for:", gameTag)
  }

  kickPlayer(gameTagToKick) {
    if (!this.isAdmin) {
      this.showNotification("No tienes permisos para expulsar jugadores.", "error")
      return
    }
    if (gameTagToKick === this.currentUser.gameTag) {
      this.showNotification("No puedes expulsarte a ti mismo.", "warning")
      return
    }

    if (confirm(`¿Estás seguro de que quieres expulsar a ${gameTagToKick}?`)) {
      this.socket.send(
        JSON.stringify({
          type: "kick_player",
          roomCode: this.currentRoom,
          gameTag: this.currentUser.gameTag,
          targetGameTag: gameTagToKick,
        }),
      )
      this.showNotification(`Expulsando a ${gameTagToKick}...`, "info")
    }
  }

  unbanPlayer(gameTagToUnban) {
    if (!this.isAdmin) {
      this.showNotification("No tienes permisos para desbanear jugadores.", "error")
      return
    }

    if (confirm(`¿Estás seguro de que quieres permitir que ${gameTagToUnban} se una de nuevo?`)) {
      this.socket.send(
        JSON.stringify({
          type: "unban_player",
          roomCode: this.currentRoom,
          gameTag: this.currentUser.gameTag,
          targetGameTag: gameTagToUnban,
        }),
      )
      this.showNotification(`Permitiendo a ${gameTagToUnban} unirse de nuevo...`, "info")
    }
  }
}

const voiceChat = new MinecraftVoiceChat()

window.voiceChat = voiceChat
