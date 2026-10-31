/**
 * Skribbl Friends - P2P Multiplayer via PeerJS
 */

// Аватары на выбор
const AVATARS = ["🐱", "🐶", "🦊", "🐸", "🐼", "🐵", "🦁", "🤖"];
let selectedAvatar = AVATARS[0];

// Локальное состояние игрока
const myState = {
  id: null,
  name: "Игрок",
  avatar: selectedAvatar,
  isHost: false,
  score: 0,
  hasGuessed: false
};

// Состояние комнаты (хранится и синхронизируется хостом)
let gameState = {
  roomCode: null,
  players: [], // { id, name, avatar, score, hasGuessed, isHost }
  currentDrawerId: null,
  currentWord: "",
  round: 1,
  maxRounds: 3,
  timeLeft: 60,
  status: "LOBBY" // 'LOBBY', 'CHOOSING_WORD', 'DRAWING', 'ROUND_END', 'GAME_OVER'
};

// PeerJS переменные
let peer = null;
let hostConn = null; // Для клиентов: соединение с хостом
let clientConns = new Map(); // Для хоста: id -> DataConnection
let roundTimerInterval = null;

// Холст и рисование
const canvas = document.getElementById("drawing-canvas");
const ctx = canvas.getContext("2d");
let isDrawing = false;
let currentColor = "#000000";
let currentBrushSize = 3;
let lastX = 0;
let lastY = 0;

// Инициализация при загрузке
window.addEventListener("DOMContentLoaded", () => {
  initAvatars();
  setupEventListeners();
  checkUrlForRoomCode();
});

// Генерация аватаров
function initAvatars() {
  const container = document.getElementById("avatars-container");
  container.innerHTML = "";
  AVATARS.forEach((av, idx) => {
    const div = document.createElement("div");
    div.className = `avatar-item ${idx === 0 ? "active" : ""}`;
    div.textContent = av;
    div.onclick = () => {
      document.querySelectorAll(".avatar-item").forEach(el => el.classList.remove("active"));
      div.classList.add("active");
      selectedAvatar = av;
      myState.avatar = av;
    };
    container.appendChild(div);
  });
}

// Проверка URL на наличие ссылки-приглашения (?room=xyz)
function checkUrlForRoomCode() {
  const urlParams = new URLSearchParams(window.location.search);
  const room = urlParams.get("room");
  if (room) {
    document.getElementById("room-code-input").value = room.toUpperCase();
  }
}

// Привязка событий
function setupEventListeners() {
  document.getElementById("btn-create-room").addEventListener("click", createRoom);
  document.getElementById("btn-join-room").addEventListener("click", joinRoom);
  document.getElementById("btn-start-game").addEventListener("click", startGame);
  document.getElementById("btn-copy-invite").addEventListener("click", copyInviteLink);

  // Чат
  document.getElementById("chat-form").addEventListener("submit", handleChatSubmit);

  // Рисование (мышь + сенсор)
  canvas.addEventListener("mousedown", startDrawing);
  canvas.addEventListener("mousemove", draw);
  window.addEventListener("mouseup", stopDrawing);

  canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
  canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
  window.addEventListener("touchend", stopDrawing);

  // Тулбар
  document.querySelectorAll(".color-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".color-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentColor = btn.dataset.color;
    });
  });

  document.querySelectorAll(".size-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".size-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentBrushSize = parseInt(btn.dataset.size, 10);
    });
  });

  document.getElementById("btn-eraser").addEventListener("click", () => {
    currentColor = "#ffffff";
  });

  document.getElementById("btn-clear-canvas").addEventListener("click", () => {
    if (myState.id === gameState.currentDrawerId) {
      clearCanvasLocal();
      broadcast({ type: "CANVAS_CLEAR" });
    }
  });
}

// -------------------------------------------------------------
// P2P ЛОГИКА (PEERJS)
// -------------------------------------------------------------

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let i = 0; i < 5; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function getPlayerName() {
  const val = document.getElementById("username-input").value.trim();
  return val ? val : "Игрок_" + Math.floor(Math.random() * 1000);
}

// Создание комнаты (Хост)
function createRoom() {
  myState.name = getPlayerName();
  myState.isHost = true;
  const roomCode = generateRoomCode();
  const peerId = "skribbl-" + roomCode;

  peer = new Peer(peerId);

  peer.on("open", (id) => {
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

    openGameView();
    document.getElementById("btn-start-game").classList.remove("hidden");
    addChatMessage({ sender: "Система", text: `Комната создана! Код: ${roomCode}`, type: "system" });
  });

  peer.on("connection", (conn) => {
    // Входящее подключение нового игрока
    clientConns.set(conn.peer, conn);

    conn.on("data", (data) => {
      handleHostReceivedData(conn.peer, data);
    });

    conn.on("close", () => {
      handlePlayerDisconnect(conn.peer);
    });
  });

  peer.on("error", (err) => {
    alert("Ошибка PeerJS: " + err.type + ". Попробуйте снова!");
  });
}

// Подключение к комнате (Клиент)
function joinRoom() {
  const code = document.getElementById("room-code-input").value.trim().toUpperCase();
  if (!code) {
    alert("Пожалуйста, введите код комнаты!");
    return;
  }

  myState.name = getPlayerName();
  myState.isHost = false;
  const targetPeerId = "skribbl-" + code;

  peer = new Peer();

  peer.on("open", (id) => {
    myState.id = id;
    hostConn = peer.connect(targetPeerId);

    hostConn.on("open", () => {
      gameState.roomCode = code;
      openGameView();

      // Отправляем хосту данные о себе
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
      alert("Соединение с хостом потеряно!");
      location.reload();
    });
  });

  peer.on("error", (err) => {
    alert("Не удалось подключиться к комнате: " + code + ". Проверьте код.");
  });
}

// Отправка сообщений всем игрокам
function broadcast(message) {
  if (myState.isHost) {
    clientConns.forEach(conn => {
      if (conn.open) conn.send(message);
    });
  } else if (hostConn && hostConn.open) {
    hostConn.send(message);
  }
}

// Обработка входящих данных на Хосте
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
        message: { sender: "Система", text: `${newPlayer.name} присоединился к игре!`, type: "system" }
      });
      break;
    }

    case "DRAW_STROKE": {
      // Пересылаем штрихи всем остальным
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

// Обработка данных на Клиенте
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
    addChatMessage({ sender: "Система", text: `${p.name} покинул игру.`, type: "system" });
    broadcastState();
  }
}

// Хост синхронизирует состояние со всеми
function broadcastState() {
  if (!myState.isHost) return;

  // Для безопасности клиентов скрываем реальное слово, если они не рисуют
  clientConns.forEach((conn, id) => {
    const isDrawingPlayer = (id === gameState.currentDrawerId);
    const sanitizedState = JSON.parse(JSON.stringify(gameState));
    if (!isDrawingPlayer && gameState.status === "DRAWING") {
      sanitizedState.currentWord = ""; // прячем слово
    }
    if (conn.open) {
      conn.send({ type: "STATE_SYNC", state: sanitizedState });
    }
  });

  updateUI();
}

// -------------------------------------------------------------
// ИГРОВОЙ ЦИКЛ (ЛОГИКА ХОСТА)
// -------------------------------------------------------------

function startGame() {
  if (!myState.isHost) return;
  if (gameState.players.length < 1) {
    alert("Нужно хотя бы 2 игрока для интересной игры!");
  }
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
    message: { sender: "Система", text: `${drawer.name} сейчас выбирает слово...`, type: "system" }
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

  // Если игрок уже угадал или это рисующий
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

    // Очки рисующему
    const drawer = gameState.players.find(x => x.id === gameState.currentDrawerId);
    if (drawer) drawer.score += 25;

    broadcast({
      type: "CHAT_MESSAGE",
      message: { sender: "🎉 Успех", text: `${p.name} угадал(а) слово! (+${pointsAwarded})`, type: "correct" }
    });

    broadcastState();

    // Проверяем, все ли угадали
    const guessers = gameState.players.filter(x => x.id !== gameState.currentDrawerId);
    const allGuessed = guessers.every(x => x.hasGuessed);
    if (allGuessed && guessers.length > 0) {
      clearInterval(roundTimerInterval);
      endTurnTimeUp();
    }
  } else {
    // Обычное сообщение в чат
    broadcast({
      type: "CHAT_MESSAGE",
      message: { sender: p.name, text: text, type: "normal" }
    });
  }
}

function endTurnTimeUp() {
  broadcast({
    type: "CHAT_MESSAGE",
    message: { sender: "Система", text: `Раунд окончен! Загаданное слово было: "${gameState.currentWord}"`, type: "close" }
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
    message: { sender: "🏆 Победитель", text: `Игра окончена! Победил ${winner ? winner.name : "Никто"} с очками: ${winner ? winner.score : 0}!`, type: "correct" }
  });
}

// -------------------------------------------------------------
// РИСОВАНИЕ НА ХОЛСТЕ
// -------------------------------------------------------------

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

// -------------------------------------------------------------
// ИНТЕРФЕЙС И UI
// -------------------------------------------------------------

function openGameView() {
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("game-screen").classList.remove("hidden");
  document.getElementById("current-room-code").textContent = gameState.roomCode;
  clearCanvasLocal();
}

function updateUI() {
  // Список игроков
  const playersList = document.getElementById("players-list");
  playersList.innerHTML = "";
  document.getElementById("players-count").textContent = gameState.players.length;

  gameState.players.forEach(p => {
    const card = document.createElement("div");
    card.className = `player-card ${p.id === gameState.currentDrawerId ? "drawing" : ""} ${p.hasGuessed ? "guessed" : ""}`;

    card.innerHTML = `
      <div class="player-info">
        <span class="player-avatar">${p.avatar}</span>
        <span class="player-name">${escapeHtml(p.name)} ${p.id === gameState.currentDrawerId ? "✏️" : ""}</span>
      </div>
      <span class="player-score">${p.score} очков</span>
    `;
    playersList.appendChild(card);
  });

  // Таймер и раунды
  document.getElementById("timer-display").textContent = gameState.timeLeft;
  document.getElementById("round-badge").textContent = `Раунд ${gameState.round}/${gameState.maxRounds}`;

  // Слово / маска
  const maskDisplay = document.getElementById("word-mask-display");
  const isDrawer = (myState.id === gameState.currentDrawerId);

  if (gameState.status === "DRAWING") {
    if (isDrawer) {
      maskDisplay.textContent = gameState.currentWord.toUpperCase();
    } else {
      // Маска из подчёркиваний: _ _ _ _
      maskDisplay.textContent = gameState.currentWord 
        ? gameState.currentWord.toUpperCase() 
        : "_ ".repeat(3).trim(); // Заглушка, если слово скрыто
    }
  } else if (gameState.status === "CHOOSING_WORD") {
    maskDisplay.textContent = "ВЫБОР СЛОВА...";
  } else {
    maskDisplay.textContent = "ОЖИДАНИЕ...";
  }

  // Тулбар активен только для рисующего
  const toolbar = document.getElementById("toolbar");
  if (isDrawer && gameState.status === "DRAWING") {
    toolbar.style.opacity = "1";
    toolbar.style.pointerEvents = "auto";
  } else {
    toolbar.style.opacity = "0.4";
    toolbar.style.pointerEvents = "none";
  }
}

// Модалка выбора слова
function showWordPicker(words) {
  const modal = document.getElementById("word-picker-modal");
  const container = document.getElementById("word-choices");
  container.innerHTML = "";

  words.forEach(w => {
    const btn = document.createElement("button");
    btn.className = "word-choice-btn";
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
  document.getElementById("word-picker-modal").classList.add("hidden");
}

// Чат
function handleChatSubmit(e) {
  e.preventDefault();
  const input = document.getElementById("chat-input");
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
  const container = document.getElementById("chat-messages");
  const div = document.createElement("div");
  div.className = `chat-msg ${msg.type || "normal"}`;

  if (msg.type === "system" || msg.type === "correct" || msg.type === "close") {
    div.textContent = msg.text;
  } else {
    div.innerHTML = `<strong>${escapeHtml(msg.sender)}:</strong> ${escapeHtml(msg.text)}`;
  }

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// Копирование ссылки
function copyInviteLink() {
  const url = `${window.location.origin}${window.location.pathname}?room=${gameState.roomCode}`;
  navigator.clipboard.writeText(url).then(() => {
    alert("Ссылка скопирована! Отправь её друзьям:\n" + url);
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
