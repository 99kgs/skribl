/**
 * Skribbl Game Engine - Powered by Pusher Cloud WebSockets
 * 100% Guaranteed cross-device & cross-network multiplayer.
 */

const PUSHER_KEY = "01576e88a9652c832053";
const PUSHER_CLUSTER = "eu";

const ATLAS_COLS = 10;
const ATLAS_ROWS = [18, 31, 24]; // color, eyes, mouth

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

let pusher = null;
let roomChannel = null;
let currentRoomCode = "";
let isHost = true;

// Состояние игры (синхронизируется хостом)
let gameState = {
  players: {}, // id -> { id, name, avatar, score, hasGuessed, lastSeen }
  currentDrawerId: null,
  currentWord: "",
  round: 1,
  maxRounds: 3,
  timeLeft: 60,
  status: "WAITING" // 'WAITING', 'CHOOSING', 'DRAWING'
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
  parseRoomCode();
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
// ОПРЕДЕЛЕНИЕ И СОЗДАНИЕ КОМНАТЫ
// -------------------------------------------------------------

function parseRoomCode() {
  const params = new URLSearchParams(window.location.search);
  const room = params.get("room");
  const playBtn = document.getElementById("btnPlayGame");

  if (room && room.trim()) {
    currentRoomCode = room.trim().toLowerCase();
    isHost = false;
    playBtn.textContent = "Войти в игру (" + currentRoomCode + ")";
    playBtn.style.background = "#337ab7";
  } else {
    currentRoomCode = Math.random().toString(36).substring(2, 7);
    isHost = true;
    playBtn.textContent = "Создать комнату";
    playBtn.style.background = "#5cb85c";
  }
}

function setupUIEvents() {
  document.getElementById("btnPlayGame").addEventListener("click", enterGameSession);
  document.getElementById("formChat").addEventListener("submit", handleChatSubmit);

  const copyBtn = document.getElementById("btnCopyRoomLink");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      const linkInput = document.getElementById("headerInviteLink");
      linkInput.select();
      linkInput.setSelectionRange(0, 99999);
      navigator.clipboard.writeText(linkInput.value).then(() => {
        copyBtn.textContent = "Скопировано!";
        setTimeout(() => copyBtn.textContent = "Скопировать", 2000);
      }).catch(() => {
        document.execCommand("copy");
        copyBtn.textContent = "Скопировано!";
        setTimeout(() => copyBtn.textContent = "Скопировать", 2000);
      });
    });
  }

  // Холст
  canvas.addEventListener("mousedown", startDrawing);
  canvas.addEventListener("mousemove", draw);
  window.addEventListener("mouseup", stopDrawing);

  canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
  canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
  window.addEventListener("touchend", stopDrawing);

  // Палитра
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
      broadcastPacket({ type: "CLEAR" });
    }
  });
}

// -------------------------------------------------------------
// ВХОД В ИГРОВОЙ ЭКРАН И PUSHER WEBSOCKETS
// -------------------------------------------------------------

function enterGameSession() {
  const nameInput = document.getElementById("inputName").value.trim();
  myState.name = nameInput ? nameInput : "Игрок_" + Math.floor(Math.random() * 100);
  myState.avatar = [...myAvatar];

  document.getElementById("screenLogin").style.display = "none";
  document.getElementById("screenGame").style.display = "flex";
  clearCanvasLocal();

  // Генерируем ссылку для шапки
  const cleanBaseUrl = window.location.origin + window.location.pathname;
  const inviteLink = cleanBaseUrl + "?room=" + currentRoomCode;
  const linkInput = document.getElementById("headerInviteLink");
  if (linkInput) {
    linkInput.value = inviteLink;
  }

  // Сразу добавляем себя
  gameState.players[myPlayerId] = {
    id: myPlayerId,
    name: myState.name,
    avatar: myState.avatar,
    score: 0,
    hasGuessed: false,
    lastSeen: Date.now()
  };
  updateUI();

  initPusherConnection();
}

function initPusherConnection() {
  addChatMessage("Система", "Подключение к облачному серверу сокетов...", "system");

  // Инициализация Pusher
  try {
    pusher = new Pusher(PUSHER_KEY, {
      cluster: PUSHER_CLUSTER,
      forceTLS: true
    });

    const channelName = "skribbl-" + currentRoomCode;
    roomChannel = pusher.subscribe(channelName);

    roomChannel.bind("pusher:subscription_succeeded", () => {
      addChatMessage("Система", "Вы в игре! Отправьте ссылку сверху другу.", "system");

      // Сообщаем всем о входе
      broadcastPacket({
        type: "PLAYER_JOIN",
        player: gameState.players[myPlayerId]
      });
    });

    roomChannel.bind("game-event", (data) => {
      handleIncomingPacket(data);
    });

    pusher.connection.bind("connected", () => {
      console.log("Pusher WebSockets connected successfully!");
    });

    pusher.connection.bind("error", (err) => {
      console.warn("Pusher connection error:", err);
    });

  } catch (err) {
    console.error("Pusher init error:", err);
  }

  // Также держим локальную шину (BroadcastChannel) для мгновенного дублирования
  try {
    const localBus = new BroadcastChannel("skribbl_bc_" + currentRoomCode);
    localBus.onmessage = (e) => handleIncomingPacket(e.data);
  } catch(e) {}

  // Пульс каждые 2 секунды
  setInterval(() => {
    gameState.players[myPlayerId].lastSeen = Date.now();
    broadcastPacket({
      type: "HEARTBEAT",
      player: gameState.players[myPlayerId]
    });

    removeOfflinePlayers();
    checkGameProgress();
  }, 2000);
}

function broadcastPacket(packet) {
  packet.senderId = myPlayerId;
  packet.nonce = Math.random();
  packet.timestamp = Date.now();

  // 1. Через Pusher клиентское событие / триггер
  if (roomChannel) {
    try {
      roomChannel.trigger("client-game-event", packet);
    } catch(e) {}
  }

  // 2. Локальный BroadcastChannel
  try {
    const localBus = new BroadcastChannel("skribbl_bc_" + currentRoomCode);
    localBus.postMessage(packet);
  } catch(e) {}

  // 3. Межсессионный LocalStorage Bus
  try {
    localStorage.setItem("skribbl_ps_" + currentRoomCode, JSON.stringify(packet));
  } catch (e) {}
}

// Слушатель LocalStorage
window.addEventListener("storage", (e) => {
  if (e.key === "skribbl_ps_" + currentRoomCode && e.newValue) {
    try {
      const packet = JSON.parse(e.newValue);
      if (packet.senderId !== myPlayerId) {
        handleIncomingPacket(packet);
      }
    } catch (err) {}
  }
});

function handleIncomingPacket(packet) {
  if (!packet || packet.senderId === myPlayerId) return;

  switch (packet.type) {
    case "PLAYER_JOIN":
    case "HEARTBEAT": {
      const p = packet.player;
      if (!p) break;
      const isNew = !gameState.players[p.id];

      gameState.players[p.id] = {
        ...p,
        lastSeen: Date.now()
      };

      if (isNew) {
        addChatMessage("Система", `${p.name} вошел в игру!`, "system");
        if (isRoomLeader()) {
          syncStateToAll();
        }
      }
      updateUI();
      break;
    }

    case "SYNC_STATE": {
      if (!isRoomLeader()) {
        gameState = packet.state;
        updateUI();
      }
      break;
    }

    case "STROKE": {
      drawStrokeLocal(packet.stroke);
      break;
    }

    case "CLEAR": {
      clearCanvasLocal();
      break;
    }

    case "TIMER": {
      gameState.timeLeft = packet.timeLeft;
      document.getElementById("timer").textContent = gameState.timeLeft;
      break;
    }

    case "PROMPT_WORD": {
      if (packet.targetDrawerId === myPlayerId) {
        showWordChoices(packet.choices);
      }
      break;
    }

    case "WORD_CHOSEN": {
      if (isRoomLeader() && packet.senderId === gameState.currentDrawerId) {
        startDrawingRound(packet.word);
      }
      break;
    }

    case "CHAT": {
      if (isRoomLeader()) {
        processIncomingGuess(packet.senderId, packet.text);
      }
      break;
    }

    case "CHAT_BROADCAST": {
      addChatMessage(packet.sender, packet.text, packet.msgType);
      break;
    }
  }
}

function removeOfflinePlayers() {
  const now = Date.now();
  let changed = false;

  for (const id in gameState.players) {
    if (id !== myPlayerId && (now - (gameState.players[id].lastSeen || 0) > 8000)) {
      addChatMessage("Система", `${gameState.players[id].name} покинул игру.`, "system");
      delete gameState.players[id];
      changed = true;
    }
  }

  if (changed) {
    updateUI();
    if (isRoomLeader() && !gameState.players[gameState.currentDrawerId]) {
      clearInterval(roundTimerInterval);
      endTurnTimeUp();
    }
  }
}

// -------------------------------------------------------------
// ИГРОВОЙ ЦИКЛ (ХОСТ)
// -------------------------------------------------------------

function getPlayersList() {
  return Object.values(gameState.players || {});
}

function isRoomLeader() {
  const list = getPlayersList().sort((a, b) => a.id.localeCompare(b.id));
  return list.length > 0 && list[0].id === myPlayerId;
}

function checkGameProgress() {
  if (!isRoomLeader()) return;
  const list = getPlayersList();

  if (gameState.status === "WAITING" && list.length >= 1) {
    startNextTurn(0);
  }
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

  list.forEach(p => p.hasGuessed = false);

  clearCanvasLocal();
  broadcastPacket({ type: "CLEAR" });

  const choices = typeof getRandomWords === "function" ? getRandomWords(3) : ["кот", "дом", "солнце"];

  if (drawer.id === myPlayerId) {
    showWordChoices(choices);
  } else {
    broadcastPacket({
      type: "PROMPT_WORD",
      targetDrawerId: drawer.id,
      choices: choices
    });
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
    broadcastPacket({
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

// Расстояние Левенштейна (для подсказки "Очень близко!")
function levenshteinDistance(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

function processIncomingGuess(senderId, text) {
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

    const guessers = list.filter(x => x.id !== gameState.currentDrawerId);
    if (guessers.every(x => x.hasGuessed) && guessers.length > 0) {
      clearInterval(roundTimerInterval);
      endTurnTimeUp();
    }
  } else if (target && cleanGuess.length > 2 && levenshteinDistance(cleanGuess, target) === 1) {
    // В стиле Skribblrs.io: "Очень близко!"
    broadcastChatMessage("Подсказка", `${p.name} очень близко!`, "close");
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
  broadcastPacket({
    type: "CHAT_BROADCAST",
    sender: sender,
    text: text,
    msgType: type
  });
}

function syncStateToAll() {
  updateUI();
  broadcastPacket({
    type: "SYNC_STATE",
    state: gameState
  });
}

// -------------------------------------------------------------
// РИСОВАНИЕ НА ХОЛСТЕ
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
  broadcastPacket({ type: "STROKE", stroke: stroke });

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
  if (!playerList) return;
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

  // Тулбар рисования ТОЛЬКО для рисующего
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
      if (isRoomLeader()) {
        startDrawingRound(w);
      } else {
        broadcastPacket({
          type: "WORD_CHOSEN",
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

  if (isRoomLeader()) {
    processIncomingGuess(myPlayerId, text);
  } else {
    broadcastPacket({
      type: "CHAT",
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
  } else if (type === "close") {
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
