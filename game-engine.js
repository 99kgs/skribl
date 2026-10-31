/**
 * Skribbl Friends - Room Invite Links & Peer-to-Peer Engine
 * Работает 100% надёжно: хост создаёт комнату и отправляет ссылку друзьям (?room=XXXXX)
 */

const ATLAS_COLS = 10;
const ATLAS_ROWS = [18, 31, 24]; // цвета, глаза, рты

let myAvatar = [
  Math.floor(Math.random() * ATLAS_ROWS[0]),
  Math.floor(Math.random() * ATLAS_ROWS[1]),
  Math.floor(Math.random() * ATLAS_ROWS[2])
];

const myPlayerId = "p_" + Math.random().toString(36).substring(2, 9);
const myState = {
  id: myPlayerId,
  name: "Игрок",
  avatar: myAvatar,
  score: 0,
  hasGuessed: false
};

// Сетевые переменные
let peer = null;
let hostConn = null;               // Клиент -> подключение к хосту
let guestConns = {};              // Хост -> словарь [peerId -> DataConnection]
let isHost = false;
let currentRoomCode = "";

// Игровое состояние (хост управляет им и рассылает клиентам)
let gameState = {
  players: {}, // id -> { id, name, avatar, score, hasGuessed }
  currentDrawerId: null,
  currentWord: "",
  round: 1,
  maxRounds: 3,
  timeLeft: 60,
  status: "WAITING" // WAITING, CHOOSING, DRAWING
};

let roundTimerInterval = null;

// Холст
let canvas, ctx;
let isDrawing = false;
let currentColor = "#000000";
let currentBrushSize = 3;
let lastX = 0;
let lastY = 0;

window.addEventListener("DOMContentLoaded", () => {
  canvas = document.getElementById("canvasGame");
  ctx = canvas.getContext("2d");

  initAvatarSprites();
  setupUIEvents();
  checkUrlRoom();
});

// -------------------------------------------------------------
// АВАТАР И СПРАЙТЫ
// -------------------------------------------------------------

function setSpriteStyle(element, index, size) {
  if (!element) return;
  const col = index % ATLAS_COLS;
  const row = Math.floor(index / ATLAS_COLS);
  element.style.backgroundPosition = `-${col * size}px -${row * size}px`;
  element.style.backgroundSize = `${size * ATLAS_COLS}px auto`;
}

function updateLoginAvatar() {
  const container = document.getElementById("loginAvatar");
  if (!container) return;
  const size = 96;

  setSpriteStyle(container.querySelector(".color"), myAvatar[0], size);
  setSpriteStyle(container.querySelector(".eyes"), myAvatar[1], size);
  setSpriteStyle(container.querySelector(".mouth"), myAvatar[2], size);
}

function initAvatarSprites() {
  updateLoginAvatar();

  document.querySelectorAll("#loginAvatarArrowsLeft .avatarArrowLeft").forEach(arrow => {
    arrow.addEventListener("click", () => {
      const idx = parseInt(arrow.dataset.avatarindex, 10);
      myAvatar[idx]--;
      if (myAvatar[idx] < 0) myAvatar[idx] = ATLAS_ROWS[idx] - 1;
      updateLoginAvatar();
    });
  });

  document.querySelectorAll("#loginAvatarArrowsRight .avatarArrowRight").forEach(arrow => {
    arrow.addEventListener("click", () => {
      const idx = parseInt(arrow.dataset.avatarindex, 10);
      myAvatar[idx]++;
      if (myAvatar[idx] >= ATLAS_ROWS[idx]) myAvatar[idx] = 0;
      updateLoginAvatar();
    });
  });

  document.getElementById("buttonAvatarCustomizerRandomize").addEventListener("click", () => {
    myAvatar[0] = Math.floor(Math.random() * ATLAS_ROWS[0]);
    myAvatar[1] = Math.floor(Math.random() * ATLAS_ROWS[1]);
    myAvatar[2] = Math.floor(Math.random() * ATLAS_ROWS[2]);
    updateLoginAvatar();
  });

  document.getElementById("buttonAvatarCustomizerCube").addEventListener("click", () => {
    document.getElementById("buttonAvatarCustomizerRandomize").click();
  });
}

// -------------------------------------------------------------
// ПРОВЕРКА URL И ИНТЕРФЕЙС ПРИГЛАШЕНИЙ
// -------------------------------------------------------------

function checkUrlRoom() {
  const params = new URLSearchParams(window.location.search);
  const roomParam = params.get("room");
  const playBtn = document.getElementById("btnPlayGame");

  if (roomParam) {
    currentRoomCode = roomParam.trim().toLowerCase();
    isHost = false;
    playBtn.textContent = "Войти в комнату (" + currentRoomCode + ")";
    playBtn.style.background = "#337ab7";
  } else {
    isHost = true;
    playBtn.textContent = "Создать комнату";
    playBtn.style.background = "#5cb85c";
  }
}

function setupUIEvents() {
  document.getElementById("btnPlayGame").addEventListener("click", onPlayClick);
  document.getElementById("formChat").addEventListener("submit", handleChatSubmit);

  // Копирование ссылки
  const copyBtn = document.getElementById("btnCopyRoomLink");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      const linkInput = document.getElementById("headerInviteLink");
      linkInput.select();
      navigator.clipboard.writeText(linkInput.value).then(() => {
        copyBtn.textContent = "Скопировано!";
        setTimeout(() => copyBtn.textContent = "Скопировать", 2000);
      });
    });
  }

  // Рисование на холсте
  canvas.addEventListener("mousedown", startDrawing);
  canvas.addEventListener("mousemove", draw);
  window.addEventListener("mouseup", stopDrawing);

  canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
  canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
  window.addEventListener("touchend", stopDrawing);

  // Цвета
  document.querySelectorAll(".colorItem").forEach(item => {
    item.addEventListener("click", () => {
      currentColor = item.dataset.color;
      document.getElementById("currentColorPreview").style.backgroundColor = currentColor;
    });
  });

  // Размеры кисти
  document.querySelectorAll(".brushSize").forEach(item => {
    item.addEventListener("click", () => {
      document.querySelectorAll(".brushSize").forEach(b => b.classList.remove("active"));
      item.classList.add("active");
      currentBrushSize = parseInt(item.dataset.size, 10);
    });
  });

  // Инструменты
  document.getElementById("toolBtnPen").addEventListener("click", () => {
    document.getElementById("toolBtnPen").classList.add("active");
    document.getElementById("toolBtnEraser").classList.remove("active");
    currentColor = document.getElementById("currentColorPreview").style.backgroundColor || "#000000";
  });

  document.getElementById("toolBtnEraser").addEventListener("click", () => {
    document.getElementById("toolBtnEraser").classList.add("active");
    document.getElementById("toolBtnPen").classList.remove("active");
    currentColor = "#ffffff";
  });

  document.getElementById("buttonClearCanvas").addEventListener("click", () => {
    if (gameState.currentDrawerId === myPlayerId) {
      clearCanvasLocal();
      broadcast({ type: "CLEAR" });
    }
  });
}

// -------------------------------------------------------------
// ЗАПУСК И СЕТЕВАЯ ЧАСТЬ (PEERJS)
// -------------------------------------------------------------

function onPlayClick() {
  const nameInput = document.getElementById("inputName").value.trim();
  myState.name = nameInput ? nameInput : "Игрок_" + Math.floor(Math.random() * 100);
  myState.avatar = [...myAvatar];

  document.getElementById("screenLogin").style.display = "none";
  document.getElementById("screenGame").style.display = "flex";
  clearCanvasLocal();

  if (isHost) {
    // Генерируем красивый 5-значный код комнаты: например skr-7k2x9
    currentRoomCode = Math.random().toString(36).substring(2, 7);
    const hostPeerId = "skr-" + currentRoomCode;

    // Формируем ссылку для отправки друзьям
    const shareUrl = window.location.origin + window.location.pathname + "?room=" + currentRoomCode;
    const linkInput = document.getElementById("headerInviteLink");
    if (linkInput) linkInput.value = shareUrl;

    initHostPeer(hostPeerId);
  } else {
    // Мы подключаемся к хосту по ссылке
    const hostPeerId = "skr-" + currentRoomCode;
    const shareUrl = window.location.origin + window.location.pathname + "?room=" + currentRoomCode;
    const linkInput = document.getElementById("headerInviteLink");
    if (linkInput) linkInput.value = shareUrl;

    initGuestPeer(hostPeerId);
  }
}

const PEER_CONFIG = {
  config: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" }
    ]
  }
};

function initHostPeer(hostPeerId) {
  addChatMessage("Система", "Создание комнаты...", "system");

  peer = new Peer(hostPeerId, PEER_CONFIG);

  peer.on("open", (id) => {
    addChatMessage("Система", `Комната создана! Скопируйте ссылку сверху и отправьте друзьям.`, "system");
    // Добавляем себя в список игроков хоста
    gameState.players[myPlayerId] = { ...myState };
    updateUI();
  });

  peer.on("connection", (conn) => {
    conn.on("open", () => {
      guestConns[conn.peer] = conn;

      conn.on("data", (data) => {
        handleHostIncomingData(conn, data);
      });

      conn.on("close", () => {
        handlePlayerDisconnect(conn.peer);
      });
    });
  });

  peer.on("error", (err) => {
    console.error("PeerJS Host error:", err);
    if (err.type === "unavailable-id") {
      // Если ID занят, генерируем новый
      currentRoomCode = Math.random().toString(36).substring(2, 7);
      const newId = "skr-" + currentRoomCode;
      const shareUrl = window.location.origin + window.location.pathname + "?room=" + currentRoomCode;
      const linkInput = document.getElementById("headerInviteLink");
      if (linkInput) linkInput.value = shareUrl;
      initHostPeer(newId);
    } else {
      addChatMessage("Ошибка сети", err.message || err.type, "system");
    }
  });
}

function initGuestPeer(hostPeerId) {
  addChatMessage("Система", `Подключение к комнате хоста...`, "system");

  peer = new Peer(PEER_CONFIG);

  peer.on("open", () => {
    hostConn = peer.connect(hostPeerId, { reliable: true });

    hostConn.on("open", () => {
      addChatMessage("Система", "Успешное подключение к игре!", "system");
      // Отправляем хосту данные о себе
      hostConn.send({
        type: "JOIN",
        player: myState
      });
    });

    hostConn.on("data", (data) => {
      handleGuestIncomingData(data);
    });

    hostConn.on("close", () => {
      addChatMessage("Система", "Соединение с хостом разорвано.", "system");
    });
  });

  peer.on("error", (err) => {
    console.error("PeerJS Guest error:", err);
    addChatMessage("Ошибка", "Не удалось подключиться к хосту. Возможно, комната закрыта.", "system");
  });
}

// -------------------------------------------------------------
// ЛОГИКА ХОСТА
// -------------------------------------------------------------

function handleHostIncomingData(conn, data) {
  if (!data || !data.type) return;

  switch (data.type) {
    case "JOIN": {
      const p = data.player;
      p.peerId = conn.peer;
      gameState.players[p.id] = p;
      addChatMessage("Система", `${p.name} присоединился к игре!`, "system");

      // Отправляем полное состояние всем
      syncStateToAll();

      // Если игра ещё не началась и это хотя бы 2 игрока (или хост ждал)
      if (gameState.status === "WAITING" && Object.keys(gameState.players).length >= 1) {
        startNextTurn(0);
      }
      break;
    }

    case "STROKE": {
      // Рисующий прислал мазок - хост рисует локально и транслирует остальным
      drawStrokeLocal(data.stroke);
      broadcast(data, conn.peer);
      break;
    }

    case "CLEAR": {
      clearCanvasLocal();
      broadcast({ type: "CLEAR" }, conn.peer);
      break;
    }

    case "CHAT": {
      processIncomingGuessOrChat(data.senderId, data.text);
      break;
    }

    case "WORD_CHOSEN": {
      if (data.senderId === gameState.currentDrawerId) {
        startDrawingRound(data.word);
      }
      break;
    }
  }
}

function handlePlayerDisconnect(peerId) {
  let leftPlayer = null;
  for (const id in gameState.players) {
    if (gameState.players[id].peerId === peerId) {
      leftPlayer = gameState.players[id];
      delete gameState.players[id];
      break;
    }
  }
  delete guestConns[peerId];

  if (leftPlayer) {
    addChatMessage("Система", `${leftPlayer.name} покинул игру.`, "system");
    syncStateToAll();

    // Если вышел рисующий - переходим к следующему
    if (leftPlayer.id === gameState.currentDrawerId) {
      clearInterval(roundTimerInterval);
      endTurnTimeUp();
    }
  }
}

function broadcast(data, excludePeerId = null) {
  for (const pId in guestConns) {
    if (pId !== excludePeerId && guestConns[pId].open) {
      guestConns[pId].send(data);
    }
  }
}

function syncStateToAll() {
  updateUI();
  broadcast({
    type: "STATE_SYNC",
    gameState: gameState
  });
}

// -------------------------------------------------------------
// ИГРОВОЙ ЦИКЛ НА ХОСТЕ
// -------------------------------------------------------------

function getPlayersList() {
  return Object.values(gameState.players || {});
}

function startNextTurn(nextIndex) {
  const list = getPlayersList();
  if (list.length === 0) return;

  if (nextIndex >= list.length) {
    gameState.round++;
    if (gameState.round > gameState.maxRounds) {
      gameState.round = 1;
    }
    nextIndex = 0;
  }

  const drawer = list[nextIndex];
  gameState.currentDrawerId = drawer.id;
  gameState.status = "CHOOSING";

  // Сбрасываем флаг угадывания
  list.forEach(p => p.hasGuessed = false);

  clearCanvasLocal();
  broadcast({ type: "CLEAR" });

  const choices = typeof getRandomWords === "function" ? getRandomWords(3) : ["кот", "дом", "солнце"];

  if (drawer.id === myPlayerId) {
    // Хост сам рисует
    showWordChoices(choices);
  } else {
    // Рисует гость - отправляем ему окно выбора слов
    if (drawer.peerId && guestConns[drawer.peerId]) {
      guestConns[drawer.peerId].send({
        type: "PROMPT_WORD_CHOICE",
        choices: choices
      });
    }
  }

  broadcastChatMessage("Система", `${drawer.name} сейчас выбирает слово...`, "system");
  syncStateToAll();
}

function startDrawingRound(word) {
  gameState.currentWord = word;
  gameState.status = "DRAWING";
  gameState.timeLeft = 60;
  hideWordChoices();

  const list = getPlayersList();
  const drawer = list.find(p => p.id === gameState.currentDrawerId);
  broadcastChatMessage("Система", `${drawer ? drawer.name : "Игрок"} начал рисовать!`, "system");

  syncStateToAll();

  clearInterval(roundTimerInterval);
  roundTimerInterval = setInterval(() => {
    gameState.timeLeft--;
    
    // Синхронизируем таймер
    broadcast({
      type: "TIMER",
      timeLeft: gameState.timeLeft
    });
    document.getElementById("timer").textContent = gameState.timeLeft;

    if (gameState.timeLeft <= 0) {
      clearInterval(roundTimerInterval);
      endTurnTimeUp();
    }
  }, 1000);
}

function processIncomingGuessOrChat(senderId, text) {
  const list = getPlayersList();
  const p = list.find(x => x.id === senderId);
  if (!p) return;

  if (p.hasGuessed || senderId === gameState.currentDrawerId || gameState.status !== "DRAWING") {
    broadcastChatMessage(p.name, text, "normal");
    return;
  }

  const cleanGuess = text.trim().toLowerCase();
  const target = (gameState.currentWord || "").trim().toLowerCase();

  if (cleanGuess === target) {
    const pts = Math.max(50, gameState.timeLeft * 10);
    p.score = (p.score || 0) + pts;
    p.hasGuessed = true;

    const drawer = list.find(x => x.id === gameState.currentDrawerId);
    if (drawer) drawer.score = (drawer.score || 0) + 25;

    broadcastChatMessage("🎉 Угадал", `${p.name} отгадал(а) слово! (+${pts})`, "correct");
    syncStateToAll();

    // Проверяем, все ли угадали
    const guessers = list.filter(x => x.id !== gameState.currentDrawerId);
    if (guessers.every(x => x.hasGuessed) && guessers.length > 0) {
      clearInterval(roundTimerInterval);
      endTurnTimeUp();
    }
  } else {
    broadcastChatMessage(p.name, text, "normal");
  }
}

function endTurnTimeUp() {
  broadcastChatMessage("Система", `Раунд окончен! Слово было: "${gameState.currentWord}"`, "system");

  const list = getPlayersList();
  const currIdx = list.findIndex(p => p.id === gameState.currentDrawerId);
  setTimeout(() => {
    startNextTurn(currIdx + 1);
  }, 3500);
}

function broadcastChatMessage(sender, text, type = "normal") {
  addChatMessage(sender, text, type);
  broadcast({
    type: "CHAT_MSG",
    sender: sender,
    text: text,
    msgType: type
  });
}

// -------------------------------------------------------------
// ЛОГИКА ГОСТЯ (КЛИЕНТА)
// -------------------------------------------------------------

function handleGuestIncomingData(data) {
  if (!data || !data.type) return;

  switch (data.type) {
    case "STATE_SYNC": {
      gameState = data.gameState;
      updateUI();
      break;
    }

    case "TIMER": {
      gameState.timeLeft = data.timeLeft;
      document.getElementById("timer").textContent = data.timeLeft;
      break;
    }

    case "STROKE": {
      drawStrokeLocal(data.stroke);
      break;
    }

    case "CLEAR": {
      clearCanvasLocal();
      break;
    }

    case "CHAT_MSG": {
      addChatMessage(data.sender, data.text, data.msgType);
      break;
    }

    case "PROMPT_WORD_CHOICE": {
      showWordChoices(data.choices);
      break;
    }
  }
}

// -------------------------------------------------------------
// РИСОВАНИЕ
// -------------------------------------------------------------

function getCoords(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  };
}

function startDrawing(e) {
  if (gameState.currentDrawerId !== myPlayerId || gameState.status !== "DRAWING") return;
  isDrawing = true;
  const pos = getCoords(e);
  lastX = pos.x;
  lastY = pos.y;
}

function draw(e) {
  if (!isDrawing || gameState.currentDrawerId !== myPlayerId || gameState.status !== "DRAWING") return;
  const pos = getCoords(e);

  const stroke = {
    x0: lastX,
    y0: lastY,
    x1: pos.x,
    y1: pos.y,
    color: currentColor,
    size: currentBrushSize
  };

  drawStrokeLocal(stroke);

  if (isHost) {
    broadcast({ type: "STROKE", stroke: stroke });
  } else if (hostConn && hostConn.open) {
    hostConn.send({ type: "STROKE", stroke: stroke });
  }

  lastX = pos.x;
  lastY = pos.y;
}

function stopDrawing() {
  isDrawing = false;
}

function handleTouchStart(e) {
  e.preventDefault();
  if (e.touches.length === 1) startDrawing(e.touches[0]);
}

function handleTouchMove(e) {
  e.preventDefault();
  if (e.touches.length === 1) draw(e.touches[0]);
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
// ИНТЕРФЕЙС И ВЫБОР СЛОВА
// -------------------------------------------------------------

function updateUI() {
  const playerList = document.getElementById("containerGamePlayers");
  playerList.innerHTML = "";

  const list = getPlayersList();
  list.forEach(p => {
    const card = document.createElement("div");
    card.className = "player";
    card.style.cssText = `
      display: flex !important;
      align-items: center !important;
      padding: 6px 8px !important;
      background: ${p.hasGuessed ? "#dff0d8" : (p.id === gameState.currentDrawerId ? "#d9edf7" : "#f5f5f5")};
      border-left: 4px solid ${p.hasGuessed ? "#3c763d" : "#337ab7"};
      border-radius: 4px;
    `;

    const avHolder = document.createElement("div");
    avHolder.className = "player-avatar-holder";

    const col = document.createElement("div"); col.className = "color";
    const eye = document.createElement("div"); eye.className = "eyes";
    const mou = document.createElement("div"); mou.className = "mouth";

    setSpriteStyle(col, (p.avatar ? p.avatar[0] : 0), 48);
    setSpriteStyle(eye, (p.avatar ? p.avatar[1] : 0), 48);
    setSpriteStyle(mou, (p.avatar ? p.avatar[2] : 0), 48);

    avHolder.appendChild(col);
    avHolder.appendChild(eye);
    avHolder.appendChild(mou);

    const info = document.createElement("div");
    info.style.cssText = "margin-left: 8px; flex: 1; line-height: 1.2;";
    info.innerHTML = `
      <div style="font-weight: bold; font-size: 13px;">${escapeHtml(p.name)} ${p.id === gameState.currentDrawerId ? "✏️" : ""}</div>
      <div style="font-size: 12px; color: #5cb85c; font-weight: bold;">${p.score || 0} очков</div>
    `;

    card.appendChild(avHolder);
    card.appendChild(info);
    playerList.appendChild(card);
  });

  document.getElementById("timer").textContent = gameState.timeLeft;
  document.getElementById("round").textContent = `Раунд ${gameState.round} из ${gameState.maxRounds}`;

  const wordDisplay = document.getElementById("currentWord");
  const isDrawer = (gameState.currentDrawerId === myPlayerId);

  if (gameState.status === "DRAWING") {
    if (isDrawer) {
      wordDisplay.textContent = "РИСУЙТЕ: " + (gameState.currentWord || "").toUpperCase();
    } else {
      wordDisplay.textContent = "_ ".repeat(gameState.currentWord ? gameState.currentWord.length : 4).trim();
    }
  } else if (gameState.status === "CHOOSING") {
    wordDisplay.textContent = "ВЫБОР СЛОВА...";
  } else {
    wordDisplay.textContent = "ОЖИДАНИЕ...";
  }

  // Тулбар ТОЛЬКО для рисующего игрока
  const toolbar = document.getElementById("drawingToolbar");
  if (isDrawer && gameState.status === "DRAWING") {
    toolbar.style.display = "flex";
  } else {
    toolbar.style.display = "none";
  }
}

function showWordChoices(words) {
  const modal = document.getElementById("word-select-modal");
  const cont = document.getElementById("word-select-options");
  cont.innerHTML = "";

  words.forEach(w => {
    const btn = document.createElement("button");
    btn.className = "word-btn-opt";
    btn.textContent = w;
    btn.onclick = () => {
      hideWordChoices();
      if (isHost) {
        startDrawingRound(w);
      } else if (hostConn && hostConn.open) {
        hostConn.send({
          type: "WORD_CHOSEN",
          senderId: myPlayerId,
          word: w
        });
      }
    };
    cont.appendChild(btn);
  });

  modal.classList.remove("hidden");
}

function hideWordChoices() {
  document.getElementById("word-select-modal").classList.add("hidden");
}

function handleChatSubmit(e) {
  if (e) e.preventDefault();
  const input = document.getElementById("inputChat");
  const text = input.value.trim();
  if (!text) return;

  if (isHost) {
    processIncomingGuessOrChat(myPlayerId, text);
  } else if (hostConn && hostConn.open) {
    hostConn.send({
      type: "CHAT",
      senderId: myPlayerId,
      text: text
    });
  }

  input.value = "";
}

function addChatMessage(sender, text, type = "normal") {
  const box = document.getElementById("boxMessages");
  const row = document.createElement("div");
  row.className = `chat-row ${type}`;

  if (type === "system") {
    row.textContent = text;
  } else if (type === "correct") {
    row.textContent = `${sender}: ${text}`;
  } else {
    row.innerHTML = `<strong>${escapeHtml(sender)}:</strong> ${escapeHtml(text)}`;
  }

  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
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
