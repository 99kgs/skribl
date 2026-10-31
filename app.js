/**
 * Skribbl Friends - P2P Engine adapted to Original Skribbl.io Layout
 */

const AVATARS = ["🐱", "🐶", "🦊", "🐸", "🐼", "🐵", "🦁", "🤖"];
let selectedAvatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];

const myState = {
  id: null,
  name: "Игрок",
  avatar: selectedAvatar,
  isHost: false,
  score: 0,
  hasGuessed: false
};

let gameState = {
  roomCode: null,
  players: [],
  currentDrawerId: null,
  currentWord: "",
  round: 1,
  maxRounds: 3,
  timeLeft: 60,
  status: "LOBBY"
};

let peer = null;
let hostConn = null;
let clientConns = new Map();
let roundTimerInterval = null;

// Холст
const canvas = document.getElementById("game-canvas-custom");
const ctx = canvas.getContext("2d");
let isDrawing = false;
let currentColor = "#000000";
let currentBrushSize = 3;
let lastX = 0;
let lastY = 0;

const PEER_CONFIG = {
  config: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" }
    ]
  }
};

window.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
  checkUrlForRoom();
});

function checkUrlForRoom() {
  const urlParams = new URLSearchParams(window.location.search);
  const room = urlParams.get("room");
  if (room) {
    document.getElementById("input-room-code").value = room.toUpperCase();
  }
}

function setupEventListeners() {
  document.getElementById("btn-create-lobby").addEventListener("click", createLobby);
  document.getElementById("btn-join-lobby").addEventListener("click", joinLobby);
  document.getElementById("btn-host-start").addEventListener("click", startGame);
  document.getElementById("btn-copy-code").addEventListener("click", copyInviteLink);

  document.getElementById("skribbl-chat-form").addEventListener("submit", handleChatSubmit);

  // Рисование
  canvas.addEventListener("mousedown", startDrawing);
  canvas.addEventListener("mousemove", draw);
  window.addEventListener("mouseup", stopDrawing);

  canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
  canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
  window.addEventListener("touchend", stopDrawing);

  // Палитра
  document.querySelectorAll(".color-box").forEach(el => {
    el.addEventListener("click", () => {
      currentColor = el.dataset.color;
    });
  });

  // Размеры кисти
  document.querySelectorAll(".btn-size").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".btn-size").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentBrushSize = parseInt(btn.dataset.size, 10);
    });
  });

  document.getElementById("tool-brush").addEventListener("click", () => {
    currentColor = "#000000";
  });

  document.getElementById("tool-eraser").addEventListener("click", () => {
    currentColor = "#ffffff";
  });

  document.getElementById("tool-clear").addEventListener("click", () => {
    if (myState.id === gameState.currentDrawerId) {
      clearCanvasLocal();
      broadcast({ type: "CANVAS_CLEAR" });
    }
  });
}

function getPlayerName() {
  const val = document.getElementById("player-name-input").value.trim();
  return val ? val : "Игрок_" + Math.floor(Math.random() * 1000);
}

function generateRoomCode() {
  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let result = "";
  for (let i = 0; i < 5; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Создание лобби
function createLobby() {
  myState.name = getPlayerName();
  myState.isHost = true;
  const roomCode = generateRoomCode();
  const customPeerId = "skr-" + roomCode.toLowerCase();

  const btn = document.getElementById("btn-create-lobby");
  btn.disabled = true;
  btn.textContent = "Создание комнаты...";

  if (peer) { try { peer.destroy(); } catch(e){} }

  peer = new Peer(customPeerId, PEER_CONFIG);

  peer.on("open", (id) => {
    btn.disabled = false;
    btn.textContent = "🎮 Создать приватную комнату";
    myState.id = id;
    gameState.roomCode = roomCode;
    gameState.players = [{
      id: myState.id,
      name: myState.name,
      avatar: myState.avatar,
      score: 0,
      hasGuessed: false,
      isHost: true
    }];

    enterGameScreen();
    document.getElementById("btn-host-start").style.display = "inline-block";
    addChatMessage({ sender: "Система", text: `Комната ${roomCode} открыта! Скиньте код друзьям.`, type: "system" });
  });

  peer.on("connection", (conn) => {
    conn.on("open", () => {
      clientConns.set(conn.peer, conn);
    });

    conn.on("data", (data) => {
      handleHostReceivedData(conn.peer, data);
    });

    conn.on("close", () => {
      handlePlayerDisconnect(conn.peer);
    });
  });

  peer.on("error", (err) => {
    btn.disabled = false;
    btn.textContent = "🎮 Создать приватную комнату";
    if (err.type === "unavailable-id") {
      createLobby();
    } else {
      alert("Ошибка подключения: " + err.type + ". Попробуйте еще раз!");
    }
  });
}

// Вход в лобби
function joinLobby() {
  const code = document.getElementById("input-room-code").value.trim().toUpperCase();
  if (!code) {
    alert("Введите код комнаты!");
    return;
  }

  myState.name = getPlayerName();
  myState.isHost = false;
  const targetPeerId = "skr-" + code.toLowerCase();

  const btn = document.getElementById("btn-join-lobby");
  btn.disabled = true;
  btn.textContent = "...";

  if (peer) { try { peer.destroy(); } catch(e){} }

  peer = new Peer(PEER_CONFIG);

  peer.on("open", (id) => {
    myState.id = id;
    hostConn = peer.connect(targetPeerId, { reliable: true });

    hostConn.on("open", () => {
      btn.disabled = false;
      btn.textContent = "Войти";
      gameState.roomCode = code;
      enterGameScreen();

      hostConn.send({
        type: "PLAYER_JOIN",
        player: {
          id: myState.id,
          name: myState.name,
          avatar: myState.avatar
        }
      });
    });

    hostConn.on("data", (data) => {
      handleClientReceivedData(data);
    });

    hostConn.on("close", () => {
      alert("Хост покинул комнату!");
      location.reload();
    });
  });

  peer.on("error", (err) => {
    btn.disabled = false;
    btn.textContent = "Войти";
    alert("Не удалось подключиться к комнате " + code + ". Проверьте код и убедитесь, что создатель в игре!");
  });
}

function broadcast(message) {
  if (myState.isHost) {
    clientConns.forEach(conn => {
      if (conn.open) conn.send(message);
    });
  } else if (hostConn && hostConn.open) {
    hostConn.send(message);
  }
}

function handleHostReceivedData(senderId, data) {
  switch (data.type) {
    case "PLAYER_JOIN": {
      const newPlayer = {
        id: senderId,
        name: data.player.name,
        avatar: data.player.avatar,
        score: 0,
        hasGuessed: false,
        isHost: false
      };
      gameState.players.push(newPlayer);
      broadcastState();
      broadcast({
        type: "CHAT_MESSAGE",
        message: { sender: "Система", text: `${newPlayer.name} вошел в игру!`, type: "system" }
      });
      break;
    }

    case "DRAW_STROKE": {
      clientConns.forEach((conn, id) => {
        if (id !== senderId && conn.open) conn.send(data);
      });
      drawStrokeLocal(data.stroke);
      break;
    }

    case "CANVAS_CLEAR": {
      clearCanvasLocal();
      broadcast(data);
      break;
    }

    case "WORD_CHOSEN": {
      startRoundDrawing(data.word);
      break;
    }

    case "CHAT_GUESS": {
      processGuess(senderId, data.text);
      break;
    }
  }
}

function handleClientReceivedData(data) {
  switch (data.type) {
    case "STATE_SYNC":
      gameState = data.state;
      updateUI();
      break;

    case "DRAW_STROKE":
      drawStrokeLocal(data.stroke);
      break;

    case "CANVAS_CLEAR":
      clearCanvasLocal();
      break;

    case "SHOW_WORD_PICKER":
      showWordPicker(data.words);
      break;

    case "CHAT_MESSAGE":
      addChatMessage(data.message);
      break;
  }
}

function handlePlayerDisconnect(playerId) {
  const p = gameState.players.find(x => x.id === playerId);
  clientConns.delete(playerId);
  gameState.players = gameState.players.filter(x => x.id !== playerId);
  if (p) {
    addChatMessage({ sender: "Система", text: `${p.name} вышел из игры.`, type: "system" });
    broadcastState();
  }
}

function broadcastState() {
  if (!myState.isHost) return;

  clientConns.forEach((conn, id) => {
    const isDrawingPlayer = (id === gameState.currentDrawerId);
    const sanitizedState = JSON.parse(JSON.stringify(gameState));
    if (!isDrawingPlayer && gameState.status === "DRAWING") {
      sanitizedState.currentWord = "";
    }
    if (conn.open) {
      conn.send({ type: "STATE_SYNC", state: sanitizedState });
    }
  });

  updateUI();
}

function startGame() {
  if (!myState.isHost) return;
  gameState.round = 1;
  gameState.players.forEach(p => p.score = 0);
  startTurn(0);
}

function startTurn(playerIndex) {
  if (playerIndex >= gameState.players.length) {
    gameState.round++;
    if (gameState.round > gameState.maxRounds) {
      endGame();
      return;
    }
    startTurn(0);
    return;
  }

  const drawer = gameState.players[playerIndex];
  gameState.currentDrawerId = drawer.id;
  gameState.status = "CHOOSING_WORD";
  gameState.players.forEach(p => p.hasGuessed = false);

  clearCanvasLocal();
  broadcast({ type: "CANVAS_CLEAR" });

  const choices = getRandomWords(3);

  if (drawer.id === myState.id) {
    showWordPicker(choices);
  } else {
    const conn = clientConns.get(drawer.id);
    if (conn) {
      conn.send({ type: "SHOW_WORD_PICKER", words: choices });
    }
  }

  broadcastState();
  broadcast({
    type: "CHAT_MESSAGE",
    message: { sender: "Система", text: `${drawer.name} выбирает слово...`, type: "system" }
  });
}

function startRoundDrawing(word) {
  gameState.currentWord = word;
  gameState.status = "DRAWING";
  gameState.timeLeft = 60;
  hideWordPicker();
  broadcastState();

  const drawer = gameState.players.find(p => p.id === gameState.currentDrawerId);
  broadcast({
    type: "CHAT_MESSAGE",
    message: { sender: "Система", text: `${drawer ? drawer.name : "Игрок"} начал рисовать!`, type: "system" }
  });

  clearInterval(roundTimerInterval);
  roundTimerInterval = setInterval(() => {
    gameState.timeLeft--;
    if (gameState.timeLeft <= 0) {
      clearInterval(roundTimerInterval);
      endTurnTimeUp();
    } else {
      broadcastState();
    }
  }, 1000);
}

function processGuess(senderId, text) {
  const p = gameState.players.find(x => x.id === senderId);
  if (!p) return;

  if (p.hasGuessed || senderId === gameState.currentDrawerId) {
    addChatMessage({ sender: p.name, text: text, type: "normal" });
    broadcast({
      type: "CHAT_MESSAGE",
      message: { sender: p.name, text: text, type: "normal" }
    });
    return;
  }

  const cleanGuess = text.trim().toLowerCase();
  const target = (gameState.currentWord || "").trim().toLowerCase();

  if (cleanGuess === target) {
    p.hasGuessed = true;
    const pointsAwarded = Math.max(50, gameState.timeLeft * 10);
    p.score += pointsAwarded;

    const drawer = gameState.players.find(x => x.id === gameState.currentDrawerId);
    if (drawer) drawer.score += 25;

    broadcast({
      type: "CHAT_MESSAGE",
      message: { sender: "🎉 Угадал", text: `${p.name} отгадал(а) слово! (+${pointsAwarded})`, type: "correct" }
    });

    broadcastState();

    const guessers = gameState.players.filter(x => x.id !== gameState.currentDrawerId);
    const allGuessed = guessers.every(x => x.hasGuessed);
    if (allGuessed && guessers.length > 0) {
      clearInterval(roundTimerInterval);
      endTurnTimeUp();
    }
  } else {
    broadcast({
      type: "CHAT_MESSAGE",
      message: { sender: p.name, text: text, type: "normal" }
    });
  }
}

function endTurnTimeUp() {
  broadcast({
    type: "CHAT_MESSAGE",
    message: { sender: "Система", text: `Время вышло! Слово было: "${gameState.currentWord}"`, type: "system" }
  });

  const currentIndex = gameState.players.findIndex(p => p.id === gameState.currentDrawerId);
  setTimeout(() => {
    startTurn(currentIndex + 1);
  }, 3500);
}

function endGame() {
  gameState.status = "GAME_OVER";
  broadcastState();

  const sorted = [...gameState.players].sort((a, b) => b.score - a.score);
  const winner = sorted[0];

  broadcast({
    type: "CHAT_MESSAGE",
    message: { sender: "🏆 Победа", text: `Игра окончена! Победитель: ${winner ? winner.name : "Никто"} (${winner ? winner.score : 0} очков)!`, type: "correct" }
  });
}

// Координаты холста
function getCanvasCoords(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  };
}

function startDrawing(e) {
  if (gameState.currentDrawerId !== myState.id || gameState.status !== "DRAWING") return;
  isDrawing = true;
  const pos = getCanvasCoords(e);
  lastX = pos.x;
  lastY = pos.y;
}

function draw(e) {
  if (!isDrawing || gameState.currentDrawerId !== myState.id || gameState.status !== "DRAWING") return;
  const pos = getCanvasCoords(e);

  const stroke = {
    x0: lastX,
    y0: lastY,
    x1: pos.x,
    y1: pos.y,
    color: currentColor,
    size: currentBrushSize
  };

  drawStrokeLocal(stroke);
  broadcast({ type: "DRAW_STROKE", stroke: stroke });

  lastX = pos.x;
  lastY = pos.y;
}

function stopDrawing() {
  isDrawing = false;
}

function handleTouchStart(e) {
  e.preventDefault();
  if (e.touches.length === 1) {
    const t = e.touches[0];
    startDrawing(t);
  }
}

function handleTouchMove(e) {
  e.preventDefault();
  if (e.touches.length === 1) {
    const t = e.touches[0];
    draw(t);
  }
}

function drawStrokeLocal(s) {
  ctx.beginPath();
  ctx.moveTo(s.x0, s.y0);
  ctx.lineTo(s.x1, s.y1);
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.closePath();
}

function clearCanvasLocal() {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function enterGameScreen() {
  document.body.setAttribute("data-in-game", "true");
  document.getElementById("display-room-code").textContent = gameState.roomCode;
  clearCanvasLocal();
}

function updateUI() {
  // Список игроков слева
  const playersContainer = document.getElementById("skribbl-players-list");
  playersContainer.innerHTML = "";

  gameState.players.forEach((p, idx) => {
    const pEl = document.createElement("div");
    pEl.style.cssText = `padding: 6px 10px; margin-bottom: 4px; background: ${p.id === gameState.currentDrawerId ? '#e3f2fd' : '#f5f5f5'}; border-left: 4px solid ${p.hasGuessed ? '#4caf50' : '#1976d2'}; display: flex; justify-content: space-between; font-weight: bold; font-size: 13px; border-radius: 4px;`;
    pEl.innerHTML = `
      <span>${p.avatar} ${escapeHtml(p.name)} ${p.id === gameState.currentDrawerId ? "✏️" : ""}</span>
      <span style="color:#1565c0;">${p.score}</span>
    `;
    playersContainer.appendChild(pEl);
  });

  // Таймер и раунды
  document.getElementById("game-timer").textContent = gameState.timeLeft;
  document.getElementById("game-round-info").textContent = `Раунд ${gameState.round}/${gameState.maxRounds}`;

  // Маска слова
  const hintEl = document.getElementById("game-word-hint");
  const isDrawer = (myState.id === gameState.currentDrawerId);

  if (gameState.status === "DRAWING") {
    if (isDrawer) {
      hintEl.textContent = (gameState.currentWord || "").toUpperCase();
    } else {
      hintEl.textContent = "_ ".repeat(gameState.currentWord ? gameState.currentWord.length : 4).trim();
    }
  } else if (gameState.status === "CHOOSING_WORD") {
    hintEl.textContent = "ВЫБОР СЛОВА...";
  } else {
    hintEl.textContent = "ОЖИДАНИЕ...";
  }

  // Тулбар
  const toolbar = document.getElementById("game-toolbar");
  if (isDrawer && gameState.status === "DRAWING") {
    toolbar.style.opacity = "1";
    toolbar.style.pointerEvents = "auto";
  } else {
    toolbar.style.opacity = "0.5";
    toolbar.style.pointerEvents = "none";
  }
}

function showWordPicker(words) {
  const modal = document.getElementById("overlay-word-picker");
  const container = document.getElementById("picker-choices-container");
  container.innerHTML = "";

  words.forEach(w => {
    const btn = document.createElement("button");
    btn.className = "word-btn";
    btn.textContent = w;
    btn.onclick = () => {
      hideWordPicker();
      if (myState.isHost) {
        startRoundDrawing(w);
      } else {
        hostConn.send({ type: "WORD_CHOSEN", word: w });
      }
    };
    container.appendChild(btn);
  });

  modal.classList.remove("hidden");
}

function hideWordPicker() {
  document.getElementById("overlay-word-picker").classList.add("hidden");
}

function handleChatSubmit(e) {
  e.preventDefault();
  const input = document.getElementById("skribbl-chat-input");
  const text = input.value.trim();
  if (!text) return;

  if (myState.isHost) {
    processGuess(myState.id, text);
  } else {
    hostConn.send({ type: "CHAT_GUESS", text: text });
  }

  input.value = "";
}

function addChatMessage(msg) {
  const container = document.getElementById("skribbl-chat-box");
  const div = document.createElement("div");

  if (msg.type === "system") {
    div.style.cssText = "color: #757575; font-style: italic;";
    div.textContent = msg.text;
  } else if (msg.type === "correct") {
    div.style.cssText = "color: #2e7d32; font-weight: bold;";
    div.textContent = msg.text;
  } else {
    div.innerHTML = `<strong>${escapeHtml(msg.sender)}:</strong> ${escapeHtml(msg.text)}`;
  }

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function copyInviteLink() {
  const url = `${window.location.origin}${window.location.pathname}?room=${gameState.roomCode}`;
  navigator.clipboard.writeText(url).then(() => {
    alert("Ссылка на комнату скопирована в буфер!\n" + url);
  });
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[m]);
}
