/**
 * Skribbl.io Engine - Single Global Room via Public MQTT over WebSockets
 * 100% Reliable: Works anywhere, no port forwarding, no blocked P2P, no sleeping servers.
 */

const AVATAR_LIMITS = [18, 31, 24]; // По размеру проверенных атласов
let myAvatar = [
  Math.floor(Math.random() * AVATAR_LIMITS[0]),
  Math.floor(Math.random() * AVATAR_LIMITS[1]),
  Math.floor(Math.random() * AVATAR_LIMITS[2]),
  -1
];

const myPlayerId = "u_" + Math.random().toString(36).substring(2, 9);
const myState = {
  id: myPlayerId,
  name: "Player",
  avatar: myAvatar,
  score: 0,
  hasGuessed: false
};

// ЕДИНАЯ ОБЩАЯ КОМНАТА ДЛЯ ВСЕХ ДРУЗЕЙ
const GLOBAL_ROOM_TOPIC = "skribbl_friends_99kgs_global_room_v1";

let gameState = {
  players: [], // { id, name, avatar, score, hasGuessed, lastSeen }
  currentDrawerId: null,
  currentWord: "",
  round: 1,
  maxRounds: 3,
  timeLeft: 60,
  status: "WAITING" // 'WAITING', 'CHOOSING', 'DRAWING', 'TURN_END'
};

let mqttClient = null;
let heartbeatInterval = null;
let hostElectionInterval = null;
let roundTimerInterval = null;

// Холст
let canvas, ctx;
let isDrawing = false;
let currentColor = "#000000";
let currentBrushSize = 3;
let lastX = 0;
let lastY = 0;

window.addEventListener("DOMContentLoaded", () => {
  canvas = document.getElementById("main-draw-canvas");
  ctx = canvas.getContext("2d");

  initAvatarCustomizer();
  setupEventListeners();
});

// -------------------------------------------------------------
// АВАТАРЫ (ОТОБРАЖЕНИЕ СПРАЙТОВ)
// -------------------------------------------------------------

function setSpritePos(el, idx, spriteSize = 96) {
  if (!el) return;
  const col = idx % 10;
  const row = Math.floor(idx / 10);
  el.style.backgroundPosition = `-${col * spriteSize}px -${row * spriteSize}px`;
}

function updateMainAvatar() {
  const col = document.getElementById("avatar-layer-color");
  const eye = document.getElementById("avatar-layer-eyes");
  const mou = document.getElementById("avatar-layer-mouth");

  // Поддерживаем относительные пути к атласам
  col.style.backgroundImage = 'url("color_atlas.gif")';
  eye.style.backgroundImage = 'url("eyes_atlas.gif")';
  mou.style.backgroundImage = 'url("mouth_atlas.gif")';

  setSpritePos(col, myAvatar[0] % AVATAR_LIMITS[0]);
  setSpritePos(eye, myAvatar[1] % AVATAR_LIMITS[1]);
  setSpritePos(mou, myAvatar[2] % AVATAR_LIMITS[2]);
}

function initAvatarCustomizer() {
  updateMainAvatar();

  document.querySelectorAll(".avatar-customizer .arrows.left .arrow").forEach(arrow => {
    arrow.addEventListener("click", () => {
      const idx = parseInt(arrow.dataset.avatarIndex, 10);
      myAvatar[idx]--;
      if (myAvatar[idx] < 0) myAvatar[idx] = AVATAR_LIMITS[idx] - 1;
      updateMainAvatar();
    });
  });

  document.querySelectorAll(".avatar-customizer .arrows.right .arrow").forEach(arrow => {
    arrow.addEventListener("click", () => {
      const idx = parseInt(arrow.dataset.avatarIndex, 10);
      myAvatar[idx]++;
      if (myAvatar[idx] >= AVATAR_LIMITS[idx]) myAvatar[idx] = 0;
      updateMainAvatar();
    });
  });

  document.getElementById("btn-randomize-avatar").addEventListener("click", () => {
    myAvatar[0] = Math.floor(Math.random() * AVATAR_LIMITS[0]);
    myAvatar[1] = Math.floor(Math.random() * AVATAR_LIMITS[1]);
    myAvatar[2] = Math.floor(Math.random() * AVATAR_LIMITS[2]);
    updateMainAvatar();
  });
}

// -------------------------------------------------------------
// ВХОД В ИГРУ (ОДИН КЛИК НА PLAY)
// -------------------------------------------------------------

function setupEventListeners() {
  document.getElementById("btn-play-action").addEventListener("click", enterSingleGame);
  document.getElementById("skribbl-chat-form").addEventListener("submit", handleChatSubmit);

  // Рисование
  canvas.addEventListener("mousedown", startDrawing);
  canvas.addEventListener("mousemove", draw);
  window.addEventListener("mouseup", stopDrawing);

  canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
  canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
  window.addEventListener("touchend", stopDrawing);

  // Палитра
  document.querySelectorAll(".color-swatch").forEach(el => {
    el.addEventListener("click", () => {
      document.querySelectorAll(".color-swatch").forEach(s => s.classList.remove("active"));
      el.classList.add("active");
      currentColor = el.dataset.color;
    });
  });

  // Размеры
  document.querySelectorAll(".size-dot-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".size-dot-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentBrushSize = parseInt(btn.dataset.size, 10);
    });
  });

  document.getElementById("btn-tool-pen").addEventListener("click", () => { currentColor = "#000000"; });
  document.getElementById("btn-tool-eraser").addEventListener("click", () => { currentColor = "#ffffff"; });
  document.getElementById("btn-tool-clear").addEventListener("click", () => {
    if (gameState.currentDrawerId === myPlayerId) {
      clearCanvasLocal();
      sendNetworkMsg({ type: "CANVAS_CLEAR" });
    }
  });
}

function getPlayerName() {
  const val = document.getElementById("input-username").value.trim();
  return val ? val : "Player_" + Math.floor(Math.random() * 100);
}

function enterSingleGame() {
  myState.name = getPlayerName();
  myState.avatar = [...myAvatar];

  document.getElementById("home").style.display = "none";
  document.getElementById("game").style.display = "flex";
  clearCanvasLocal();

  connectToMqttBroker();
}

// -------------------------------------------------------------
// СЕТЕВОЙ БРОКЕР (ОБЩИЙ СЕРВЕР ДЛЯ ВСЕХ БЕЗ ССЫЛОК)
// -------------------------------------------------------------

function connectToMqttBroker() {
  // Публичный открытый SSL WebSocket брокер HiveMQ
  const brokerUrl = "wss://broker.hivemq.com:8884/mqtt";
  mqttClient = mqtt.connect(brokerUrl, {
    clientId: myPlayerId,
    clean: true,
    keepalive: 30
  });

  mqttClient.on("connect", () => {
    console.log("Connected to global game room!");
    mqttClient.subscribe(GLOBAL_ROOM_TOPIC + "/#");

    // Отправляем сообщение о входе
    sendNetworkMsg({
      type: "PLAYER_HELLO",
      player: {
        id: myPlayerId,
        name: myState.name,
        avatar: myState.avatar,
        score: 0
      }
    });

    // Регулярный Heartbeat (каждые 3 сек), чтобы знать кто онлайн
    heartbeatInterval = setInterval(() => {
      sendNetworkMsg({
        type: "HEARTBEAT",
        id: myPlayerId,
        name: myState.name,
        avatar: myState.avatar
      });
      cleanupOfflinePlayers();
      checkAndRunGameCycle();
    }, 3000);
  });

  mqttClient.on("message", (topic, payload) => {
    try {
      const data = JSON.parse(payload.toString());
      if (data.senderId === myPlayerId && data.type !== "STATE_SYNC") return;
      handleNetworkMessage(data);
    } catch (e) {
      console.error(e);
    }
  });

  mqttClient.on("error", (err) => {
    console.warn("MQTT Error:", err);
  });
}

function sendNetworkMsg(msg) {
  if (mqttClient && mqttClient.connected) {
    msg.senderId = myPlayerId;
    mqttClient.publish(GLOBAL_ROOM_TOPIC + "/events", JSON.stringify(msg));
  }
}

// -------------------------------------------------------------
// ОБРАБОТКА СЕТЕВЫХ СООБЩЕНИЙ
// -------------------------------------------------------------

function handleNetworkMessage(data) {
  switch (data.type) {
    case "PLAYER_HELLO":
    case "HEARTBEAT": {
      upsertPlayer(data.player || data);
      break;
    }

    case "STATE_SYNC": {
      // Синхронизация состояния от ведущего
      if (!isRoomLeader()) {
        gameState = data.state;
        updateUI();
      }
      break;
    }

    case "DRAW_STROKE": {
      drawStrokeLocal(data.stroke);
      break;
    }

    case "CANVAS_CLEAR": {
      clearCanvasLocal();
      break;
    }

    case "WORD_CHOSEN": {
      if (isRoomLeader()) {
        startDrawingRound(data.word);
      }
      break;
    }

    case "CHAT_GUESS": {
      if (isRoomLeader()) {
        processPlayerGuess(data.senderId, data.text);
      }
      break;
    }

    case "CHAT_MESSAGE": {
      addChatMessage(data.sender, data.text, data.msgType);
      break;
    }
  }
}

function upsertPlayer(p) {
  const existing = gameState.players.find(x => x.id === p.id);
  if (existing) {
    existing.name = p.name;
    existing.avatar = p.avatar;
    existing.lastSeen = Date.now();
  } else {
    gameState.players.push({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      score: p.score || 0,
      hasGuessed: false,
      lastSeen: Date.now()
    });
    addChatMessage("Система", `${p.name} присоединился к игре!`, "system");
  }
  updateUI();
}

function cleanupOfflinePlayers() {
  const now = Date.now();
  const beforeCount = gameState.players.length;
  gameState.players = gameState.players.filter(p => (now - p.lastSeen < 8000) || p.id === myPlayerId);
  if (gameState.players.length !== beforeCount) {
    updateUI();
  }
}

// Первый игрок по алфавиту ID считается лидером комнаты (авторитетным сервером)
function isRoomLeader() {
  if (gameState.players.length === 0) return true;
  const sorted = [...gameState.players].sort((a, b) => a.id.localeCompare(b.id));
  return sorted[0].id === myPlayerId;
}

// -------------------------------------------------------------
// ИГРОВОЙ ЦИКЛ (ЗАПУСКАЕТСЯ САМ ПРИ НАЛИЧИИ ИГРОКОВ)
// -------------------------------------------------------------

function checkAndRunGameCycle() {
  if (!isRoomLeader()) return;

  // Если игра в ожидании и есть хотя бы 1 игрок — автоматически начинаем раунд!
  if (gameState.status === "WAITING" && gameState.players.length >= 1) {
    startNextTurn(0);
  }
}

function startNextTurn(nextIndex) {
  if (nextIndex >= gameState.players.length) {
    gameState.round++;
    if (gameState.round > gameState.maxRounds) {
      gameState.round = 1;
    }
    nextIndex = 0;
  }

  const drawer = gameState.players[nextIndex];
  gameState.currentDrawerId = drawer.id;
  gameState.status = "CHOOSING";
  gameState.players.forEach(p => p.hasGuessed = false);

  clearCanvasLocal();
  sendNetworkMsg({ type: "CANVAS_CLEAR" });

  const choices = typeof getRandomWords === "function" ? getRandomWords(3) : ["кот", "дом", "машина"];

  if (drawer.id === myPlayerId) {
    showWordPicker(choices);
  }

  broadcastCurrentState();
  sendNetworkMsg({
    type: "CHAT_MESSAGE",
    sender: "Система",
    text: `${drawer.name} выбирает слово...`,
    msgType: "system"
  });
}

function startDrawingRound(word) {
  gameState.currentWord = word;
  gameState.status = "DRAWING";
  gameState.timeLeft = 60;
  hideWordPicker();
  broadcastCurrentState();

  const drawer = gameState.players.find(p => p.id === gameState.currentDrawerId);
  sendNetworkMsg({
    type: "CHAT_MESSAGE",
    sender: "Система",
    text: `${drawer ? drawer.name : "Игрок"} начал рисовать!`,
    msgType: "system"
  });

  clearInterval(roundTimerInterval);
  roundTimerInterval = setInterval(() => {
    gameState.timeLeft--;
    if (gameState.timeLeft <= 0) {
      clearInterval(roundTimerInterval);
      endTurnTimeUp();
    } else {
      broadcastCurrentState();
    }
  }, 1000);
}

function processPlayerGuess(senderId, text) {
  const p = gameState.players.find(x => x.id === senderId);
  if (!p) return;

  if (p.hasGuessed || senderId === gameState.currentDrawerId) {
    sendNetworkMsg({ type: "CHAT_MESSAGE", sender: p.name, text: text, msgType: "normal" });
    return;
  }

  const cleanGuess = text.trim().toLowerCase();
  const target = (gameState.currentWord || "").trim().toLowerCase();

  if (cleanGuess === target) {
    p.hasGuessed = true;
    const points = Math.max(50, gameState.timeLeft * 10);
    p.score += points;

    const drawer = gameState.players.find(x => x.id === gameState.currentDrawerId);
    if (drawer) drawer.score += 25;

    sendNetworkMsg({
      type: "CHAT_MESSAGE",
      sender: "🎉 Угадал",
      text: `${p.name} отгадал(а) слово! (+${points})`,
      msgType: "correct"
    });

    broadcastCurrentState();

    const guessers = gameState.players.filter(x => x.id !== gameState.currentDrawerId);
    if (guessers.every(x => x.hasGuessed) && guessers.length > 0) {
      clearInterval(roundTimerInterval);
      endTurnTimeUp();
    }
  } else {
    sendNetworkMsg({ type: "CHAT_MESSAGE", sender: p.name, text: text, msgType: "normal" });
  }
}

function endTurnTimeUp() {
  sendNetworkMsg({
    type: "CHAT_MESSAGE",
    sender: "Система",
    text: `Раунд окончен! Слово было: "${gameState.currentWord}"`,
    msgType: "system"
  });

  const currIdx = gameState.players.findIndex(p => p.id === gameState.currentDrawerId);
  setTimeout(() => {
    startNextTurn(currIdx + 1);
  }, 3500);
}

function broadcastCurrentState() {
  sendNetworkMsg({ type: "STATE_SYNC", state: gameState });
  updateUI();
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
  if (gameState.currentDrawerId !== myPlayerId || gameState.status !== "DRAWING") return;
  isDrawing = true;
  const pos = getCanvasCoords(e);
  lastX = pos.x;
  lastY = pos.y;
}

function draw(e) {
  if (!isDrawing || gameState.currentDrawerId !== myPlayerId || gameState.status !== "DRAWING") return;
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
  sendNetworkMsg({ type: "DRAW_STROKE", stroke: stroke });

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
// ИНТЕРФЕЙС, СКРЫТИЕ ТУЛБАРА, ОБНОВЛЕНИЕ ЧАТА
// -------------------------------------------------------------

function updateUI() {
  // Список игроков слева со скинами
  const list = document.getElementById("game-players-list");
  list.innerHTML = "";

  gameState.players.forEach(p => {
    const card = document.createElement("div");
    card.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      margin-bottom: 4px;
      border-radius: 4px;
      background: ${p.hasGuessed ? "#dcfce7" : (p.id === gameState.currentDrawerId ? "#e0f2fe" : "#f1f5f9")};
      border: 1px solid ${p.hasGuessed ? "#22c55e" : "#cbd5e1"};
    `;

    // Иконка скина игрока (36x36)
    const avBox = document.createElement("div");
    avBox.style.cssText = "width: 36px; height: 36px; position: relative; flex-shrink: 0; overflow: hidden;";

    const cL = document.createElement("div");
    const eL = document.createElement("div");
    const mL = document.createElement("div");

    [cL, eL, mL].forEach(l => {
      l.style.cssText = "position: absolute; inset: 0; background-size: 360px 360px; background-repeat: no-repeat; image-rendering: pixelated;";
    });

    cL.style.backgroundImage = 'url("color_atlas.gif")';
    eL.style.backgroundImage = 'url("eyes_atlas.gif")';
    mL.style.backgroundImage = 'url("mouth_atlas.gif")';

    setSpritePos(cL, p.avatar[0] % AVATAR_LIMITS[0], 36);
    setSpritePos(eL, p.avatar[1] % AVATAR_LIMITS[1], 36);
    setSpritePos(mL, p.avatar[2] % AVATAR_LIMITS[2], 36);

    avBox.appendChild(cL);
    avBox.appendChild(eL);
    avBox.appendChild(mL);

    const info = document.createElement("div");
    info.style.cssText = "flex: 1; min-width: 0; line-height: 1.2;";
    info.innerHTML = `
      <div style="font-weight: bold; font-size: 13px;">${escapeHtml(p.name)} ${p.id === gameState.currentDrawerId ? "✏️" : ""}</div>
      <div style="font-size: 12px; color: #53759e; font-weight: 600;">${p.score} очков</div>
    `;

    card.appendChild(avBox);
    card.appendChild(info);
    list.appendChild(card);
  });

  // Таймер и раунды
  document.getElementById("game-timer-display").textContent = gameState.timeLeft;
  document.getElementById("game-round-display").textContent = `Round ${gameState.round} of ${gameState.maxRounds}`;

  // Маска слова
  const label = document.getElementById("game-word-label");
  const display = document.getElementById("game-word-current");
  const isDrawer = (gameState.currentDrawerId === myPlayerId);

  if (gameState.status === "DRAWING") {
    if (isDrawer) {
      label.textContent = "ТЫ РИСУЕШЬ:";
      display.textContent = (gameState.currentWord || "").toUpperCase();
    } else {
      label.textContent = "УГАДАЙ СЛОВО:";
      display.textContent = "_ ".repeat(gameState.currentWord ? gameState.currentWord.length : 4).trim();
    }
  } else if (gameState.status === "CHOOSING") {
    label.textContent = "ВЫБОР СЛОВА...";
    display.textContent = "";
  } else {
    label.textContent = "ОЖИДАНИЕ...";
    display.textContent = "";
  }

  // ТУЛБАР: ПОКАЗЫВАЕТСЯ ТОЛЬКО ТОМУ, КТО СЕЙЧАС РИСУЕТ!
  const toolbar = document.getElementById("game-toolbar");
  if (isDrawer && gameState.status === "DRAWING") {
    toolbar.style.display = "flex";
  } else {
    toolbar.style.display = "none";
  }
}

function showWordPicker(words) {
  const modal = document.getElementById("custom-word-picker");
  const cont = document.getElementById("word-picker-options");
  cont.innerHTML = "";

  words.forEach(w => {
    const btn = document.createElement("button");
    btn.className = "word-btn";
    btn.textContent = w;
    btn.onclick = () => {
      hideWordPicker();
      if (isRoomLeader()) {
        startDrawingRound(w);
      } else {
        sendNetworkMsg({ type: "WORD_CHOSEN", word: w });
      }
    };
    cont.appendChild(btn);
  });

  modal.classList.remove("hidden");
}

function hideWordPicker() {
  document.getElementById("custom-word-picker").classList.add("hidden");
}

// ЧАТ
function handleChatSubmit(e) {
  e.preventDefault();
  const input = document.getElementById("skribbl-chat-input");
  const text = input.value.trim();
  if (!text) return;

  if (isRoomLeader()) {
    processPlayerGuess(myPlayerId, text);
  } else {
    sendNetworkMsg({ type: "CHAT_GUESS", text: text });
  }

  input.value = "";
}

function addChatMessage(sender, text, type = "normal") {
  const container = document.getElementById("skribbl-chat-messages");
  const div = document.createElement("div");
  div.className = `chat-msg ${type}`;

  if (type === "system") {
    div.textContent = text;
  } else if (type === "correct") {
    div.textContent = `${sender}: ${text}`;
  } else {
    div.innerHTML = `<strong>${escapeHtml(sender)}:</strong> ${escapeHtml(text)}`;
  }

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
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
