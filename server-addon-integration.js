const express = require("express")
const app = express()
const rooms = [] // Assuming rooms is an array of room objects
const WebSocket = require("ws") // Assuming WebSocket is used for communication

// Function to broadcast messages to all clients in a room except the sender
function broadcastToRoom(roomId, message, senderWs) {
  rooms.forEach((room) => {
    if (room.id === roomId) {
      room.players.forEach((player) => {
        if (player.ws !== senderWs) {
          player.ws.send(JSON.stringify(message))
        }
      })
    }
  })
}

// Function to calculate nearby players
function calculateNearbyPlayers(room, gameTag) {
  // Implement logic to calculate nearby players
  return []
}

// Agregar estas rutas a tu server.js existente

// Ruta para recibir posiciones del addon de Minecraft
app.post("/api/position", express.json(), (req, res) => {
  const { gameTag, position, dimension, timestamp } = req.body

  // Buscar el jugador en las salas activas
  let playerFound = false

  rooms.forEach((room) => {
    const player = Array.from(room.players.values()).find((p) => p.gameTag === gameTag)
    if (player) {
      // Actualizar posición del jugador
      player.position = position
      player.dimension = dimension
      player.lastPositionUpdate = timestamp

      // Notificar a otros jugadores en la sala
      broadcastToRoom(
        room.id,
        {
          type: "position_update",
          gameTag: gameTag,
          position: position,
          dimension: dimension,
        },
        player.ws,
      )

      playerFound = true
    }
  })

  if (playerFound) {
    res.json({ success: true, message: "Position updated" })
  } else {
    res.status(404).json({ error: "Player not found in any room" })
  }
})

// Ruta para enviar comandos al addon
app.post("/api/addon-command", express.json(), (req, res) => {
  const { command, gameTag, data } = req.body

  // En una implementación real, aquí enviarías el comando al addon
  // Por ahora, solo registramos el comando
  console.log(`Command for ${gameTag}: ${command}`, data)

  res.json({ success: true, message: "Command sent to addon" })
})

// Función auxiliar para enviar comandos al addon
function sendAddonCommand(gameTag, command, data) {
  // En una implementación real, esto se comunicaría con el addon
  const payload = {
    command: command,
    gameTag: gameTag,
    data: data,
    timestamp: Date.now(),
  }

  // Simular envío al addon
  console.log("Sending to addon:", payload)

  // Aquí podrías usar WebSocket o HTTP para comunicarte con el addon
}

// Modificar el manejo de mensajes WebSocket para incluir comandos del addon
function handleAddonMessage(ws, message) {
  switch (message.type) {
    case "addon_position_update":
      handleAddonPositionUpdate(ws, message)
      break
    case "addon_player_connect":
      handleAddonPlayerConnect(ws, message)
      break
    case "addon_player_disconnect":
      handleAddonPlayerDisconnect(ws, message)
      break
  }
}

function handleAddonPositionUpdate(ws, message) {
  const { gameTag, position, dimension } = message.data

  // Buscar jugador y actualizar posición
  rooms.forEach((room) => {
    const player = Array.from(room.players.values()).find((p) => p.gameTag === gameTag)
    if (player) {
      player.position = position
      player.dimension = dimension

      // Calcular jugadores cercanos y enviar audio si es necesario
      const nearbyPlayers = calculateNearbyPlayers(room, gameTag)

      // Notificar cambios de proximidad
      broadcastToRoom(room.id, {
        type: "proximity_update",
        gameTag: gameTag,
        nearbyPlayers: nearbyPlayers,
      })
    }
  })
}

function handleAddonPlayerConnect(ws, message) {
  // Implement logic to handle player connection
}

function handleAddonPlayerDisconnect(ws, message) {
  // Implement logic to handle player disconnection
}

// Assuming WebSocket server is set up
const wss = new WebSocket.Server({ port: 8080 })

wss.on("connection", (ws) => {
  ws.on("message", (message) => {
    const data = JSON.parse(message)
    handleAddonMessage(ws, data)
  })
})
