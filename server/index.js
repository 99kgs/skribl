/**
 * Minimal relay for skribbl (draw + game packets).
 * Deploy on Render/Railway/Fly, then open site with ?server=https://YOUR-HOST
 */
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors({ origin: "*" }));
app.get("/", (_req, res) => res.send("skribbl websocket ok"));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 2e6
});

io.on("connection", (socket) => {
  socket.on("join", ({ room, playerId }) => {
    if (!room) return;
    socket.join(String(room).toLowerCase());
    socket.data.room = String(room).toLowerCase();
    socket.data.playerId = playerId || socket.id;
  });

  socket.on("relay", (packet) => {
    const room = socket.data.room;
    if (!room || !packet) return;
    packet.senderId = packet.senderId || socket.data.playerId;
    socket.to(room).emit("relay", packet);
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
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log("skribbl server on", port);
});
