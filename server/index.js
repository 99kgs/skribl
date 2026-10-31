/**
 * Relay + room roster so all players see each other in the same room.
 */
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors({ origin: "*" }));
app.get("/", (_req, res) => res.type("text").send("skribbl websocket ok"));
app.get("/health", (_req, res) => res.json({ ok: true, service: "skribbl-verity-server" }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 2e6
});

/** roomId -> Map(playerId -> player profile) */
const roomRosters = new Map();

function getRoster(room) {
  const key = String(room).toLowerCase();
  if (!roomRosters.has(key)) roomRosters.set(key, new Map());
  return roomRosters.get(key);
}

function relayToRoom(socket, packet) {
  const room = socket.data.room;
  if (!room || !packet) return;
  packet.senderId = packet.senderId || socket.data.playerId;
  socket.to(room).emit("relay", packet);
}

io.on("connection", (socket) => {
  socket.on("join", ({ room, playerId, player }, ack) => {
    if (!room) return;
    const roomKey = String(room).toLowerCase();
    socket.join(roomKey);
    socket.data.room = roomKey;
    socket.data.playerId = playerId || socket.id;

    const roster = getRoster(roomKey);
    if (player && playerId) {
      roster.set(playerId, player);
    }

    roster.forEach((existingPlayer, id) => {
      if (id === socket.data.playerId) return;
      socket.emit("relay", {
        type: "PLAYER_JOIN",
        senderId: id,
        player: existingPlayer,
        nonce: Math.random(),
        timestamp: Date.now()
      });
    });

    if (player && playerId) {
      relayToRoom(socket, {
        type: "PLAYER_JOIN",
        player,
        nonce: Math.random(),
        timestamp: Date.now()
      });
    }

    if (typeof ack === "function") {
      ack({ ok: true, players: roster.size });
    }
  });

  socket.on("relay", (packet) => {
    relayToRoom(socket, packet);
  });

  socket.on("draw", (data) => {
    const room = socket.data.room;
    if (!room || !data) return;
    data.senderId = data.senderId || socket.data.playerId;
    socket.to(room).emit("draw", data);
  });

  socket.on("clear", () => {
    const room = socket.data.room;
    if (!room) return;
    socket.to(room).emit("clear");
  });

  socket.on("disconnect", () => {
    const room = socket.data.room;
    const playerId = socket.data.playerId;
    if (!room || !playerId) return;
    const roster = roomRosters.get(room);
    if (roster) {
      roster.delete(playerId);
      if (roster.size === 0) roomRosters.delete(room);
    }
    socket.to(room).emit("relay", {
      type: "PLAYER_LEAVE",
      playerId,
      senderId: playerId,
      nonce: Math.random(),
      timestamp: Date.now()
    });
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log("skribbl server on", port);
});
