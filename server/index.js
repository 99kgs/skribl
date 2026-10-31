/**
 * Relay + room roster — hardened for Render (no crash on disconnect).
 */
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

process.on("uncaughtException", (err) => {
  console.error("uncaughtException", err);
});
process.on("unhandledRejection", (err) => {
  console.error("unhandledRejection", err);
});

const app = express();
app.set("trust proxy", 1);
app.use(cors({ origin: "*" }));

app.get("/", (_req, res) => res.type("text").send("skribl websocket ok"));
app.get("/health", (_req, res) => res.json({ ok: true, service: "skribl-verity-server" }));
app.get("/favicon.ico", (_req, res) => res.status(204).end());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 2e6,
  pingTimeout: 60000,
  pingInterval: 25000
});

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
  io.to(room).emit("relay", packet);
}

io.on("connection", (socket) => {
  console.log("connect", socket.id);

  socket.on("join", (payload, ack) => {
    try {
      const { room, playerId, player } = payload || {};
      if (!room) {
        if (typeof ack === "function") ack({ ok: false, error: "no room" });
        return;
      }
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
    } catch (err) {
      console.error("join error", err);
      if (typeof ack === "function") ack({ ok: false });
    }
  });

  socket.on("relay", (packet) => {
    try {
      relayToRoom(socket, packet);
    } catch (err) {
      console.error("relay error", err);
    }
  });

  socket.on("draw", (data) => {
    try {
      const room = socket.data.room;
      if (!room || !data) return;
      data.senderId = data.senderId || socket.data.playerId;
      io.to(room).emit("draw", data);
    } catch (err) {
      console.error("draw error", err);
    }
  });

  socket.on("clear", () => {
    try {
      const room = socket.data.room;
      if (!room) return;
      io.to(room).emit("clear");
    } catch (err) {
      console.error("clear error", err);
    }
  });

  socket.on("disconnect", (reason) => {
    try {
      const room = socket.data.room;
      const playerId = socket.data.playerId;
      console.log("disconnect", socket.id, reason);
      if (!room || !playerId) return;

      const roster = roomRosters.get(room);
      if (roster) {
        roster.delete(playerId);
        if (roster.size === 0) roomRosters.delete(room);
      }

      io.to(room).emit("relay", {
        type: "PLAYER_LEAVE",
        playerId,
        senderId: playerId,
        nonce: Math.random(),
        timestamp: Date.now()
      });
    } catch (err) {
      console.error("disconnect error", err);
    }
  });
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, "0.0.0.0", () => {
  console.log("skribl server listening on", port);
});
