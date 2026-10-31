/**
 * Skribbl Friends - Real Multi-Device Engine via Trystero BitTorrent/WebRTC
 * Works across any phones, PCs and browsers globally without servers!
 */

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

// ЕДИНАЯ ГЛОБАЛЬНАЯ КОМНАТА
let gameState = {
  players: [],
  currentDrawerId: null,
  currentWord: "",
  round: 1,
  maxRounds: 3,
  timeLeft: 60,
  status: "WAITING"
};

let trysteroRoom = null;
let sendNetworkData = null;
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
});

// -------------------------------------------------------------
// ОТРИСОВКА СПРАЙТОВ АВАТАРА
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
// ВХОД И СЕТЬ (TRYSTERO: РАБОТАЕТ ВЕЗДЕ)
// -------------------------------------------------------------

function setupUIEvents() {
  document.getElementById("btnPlayGame").addEventListener("click", startGameSession);
  document.getElementById("formChat").addEventListener("submit", handleChatSubmit);

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

  // Размеры
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
      sendNetworkMsg({ type: "CANVAS_CLEAR" });
    }
  });
}

function startGameSession() {
  const nameInput = document.getElementById("inputName").value.trim();
  myState.name = nameInput ? nameInput : "Игрок_" + Math.floor(Math.random() * 100);
  myState.avatar = [...myAvatar];

  document.getElementById("screenLogin").style.display = "none";
  document.getElementById("screenGame").style.display = "flex";
  clearCanvasLocal();

  connectToGlobalRoom();
}

function connectToGlobalRoom() {
  // Добавляем себя локально
  upsertPlayer(myState);

  // Инициализация Trystero через BitTorrent WebRTC трекеры
  try {
    const config = { appId: "skribbl-99kgs-main-v1" };
    trysteroRoom = window.trystero.joinRoom(config, "public_game_room");

    const [sendMsg, getMsg] = trysteroRoom.makeAction("game_sync");
    sendNetworkData = sendMsg;

    getMsg((data) => {
      handleIncomingNetworkData(data);
    });

    trysteroRoom.onPeerJoin((peerId) => {
      console.log("Friend connected:", peerId);
      // Сразу знакомимся с новым игроком
      sendNetworkMsg({
        type: "PLAYER_HELLO",
        player: myState
      });
      if (isRoomLeader()) {
        sendNetworkMsg({ type: "STATE_SYNC", state: gameState });
      }
    });

    trysteroRoom.onPeerLeave((peerId) => {
      console.log("Friend left:", peerId);
    });

  } catch (err) {
    console.warn("Trystero error, using local fallback:", err);
  }

  // Периодический пинг
  setInterval(() => {
    sendNetworkMsg({
      type: "PING",
      player: myState
    });
    checkHostAndStart();
  }, 2500);

  // Знакомимся со всеми
  sendNetworkMsg({
    type: "PLAYER_HELLO",
    player: myState
  });
}

function sendNetworkMsg(msg) {
  msg.senderId = myPlayerId;
  if (sendNetworkData) {
    try {
      sendNetworkData(msg);
    } catch(e) {}
  }
}

function handleIncomingNetworkData(data) {
  if (data.senderId === myPlayerId) return;

  switch (data.type) {
    case "PLAYER_HELLO":
    case "PING":
      upsertPlayer(data.player);
      break;

    case "STATE_SYNC":
      if (!isRoomLeader()) {
        gameState = data.state;
        updateUI();
      }
      break;

    case "DRAW_STROKE":
      drawStrokeLocal(data.stroke);
      break;

    case "CANVAS_CLEAR":
      clearCanvasLocal();
      break;

    case "WORD_CHOSEN":
      if (isRoomLeader()) {
        startDrawingRound(data.word);
      }
      break;

    case "CHAT_GUESS":
      if (isRoomLeader()) {
        processGuess(data.senderId, data.text);
      }
      break;

    case "CHAT_MESSAGE":
      addChatMessage(data.sender, data.text, data.msgType);
      break;
  }
}

function upsertPlayer(p) {
  if (!p || !p.id) return;
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
    addChatMessage("Система", `${p.name} вошел в игру!`, "system");
  }
  updateUI();
}

function isRoomLeader() {
  if (gameState.players.length === 0) return true;
  const sorted = [...gameState.players].sort((a, b) => a.id.localeCompare(b.id));
  return sorted[0].id === myPlayerId;
}

// -------------------------------------------------------------
// ИГРОВОЙ ЦИКЛ
// -------------------------------------------------------------

function checkHostAndStart() {
  if (!isRoomLeader()) return;

  // Автостарт раунда
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

  const choices = typeof getRandomWords === "function" ? getRandomWords(3) : ["кот", "дом", "солнце"];

  if (drawer.id === myPlayerId) {
    showWordChoices(choices);
  }

  broadcastSyncState();
  sendNetworkMsg({
    type: "CHAT_MESSAGE",
    sender: "Система",
    text: `${drawer.name} сейчас выбирает слово...`,
    msgType: "system"
  });
}

function startDrawingRound(word) {
  gameState.currentWord = word;
  gameState.status = "DRAWING";
  gameState.timeLeft = 60;
  hideWordChoices();
  broadcastSyncState();

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
      broadcastSyncState();
    }
  }, 1000);
}

function processGuess(senderId, text) {
  const p = gameState.players.find(x => x.id === senderId);
  if (!p) return;

  if (p.hasGuessed || senderId === gameState.currentDrawerId) {
    sendNetworkMsg({ type: "CHAT_MESSAGE", sender: p.name, text: text, msgType: "normal" });
    addChatMessage(p.name, text, "normal");
    return;
  }

  const cleanGuess = text.trim().toLowerCase();
  const target = (gameState.currentWord || "").trim().toLowerCase();

  if (cleanGuess === target) {
    p.hasGuessed = true;
    const pts = Math.max(50, gameState.timeLeft * 10);
    p.score += pts;

    const drawer = gameState.players.find(x => x.id === gameState.currentDrawerId);
    if (drawer) drawer.score += 25;

    sendNetworkMsg({
      type: "CHAT_MESSAGE",
      sender: "🎉 Угадал",
      text: `${p.name} отгадал(а) слово! (+${pts})`,
      msgType: "correct"
    });
    addChatMessage("🎉 Угадал", `${p.name} отгадал(а) слово! (+${pts})`, "correct");

    broadcastSyncState();

    const guessers = gameState.players.filter(x => x.id !== gameState.currentDrawerId);
    if (guessers.every(x => x.hasGuessed) && guessers.length > 0) {
      clearInterval(roundTimerInterval);
      endTurnTimeUp();
    }
  } else {
    sendNetworkMsg({ type: "CHAT_MESSAGE", sender: p.name, text: text, msgType: "normal" });
    addChatMessage(p.name, text, "normal");
  }
}

function endTurnTimeUp() {
  sendNetworkMsg({
    type: "CHAT_MESSAGE",
    sender: "Система",
    text: `Раунд окончен! Слово было: "${gameState.currentWord}"`,
    msgType: "system"
  });
  addChatMessage("Система", `Раунд окончен! Слово было: "${gameState.currentWord}"`, "system");

  const currIdx = gameState.players.findIndex(p => p.id === gameState.currentDrawerId);
  setTimeout(() => {
    startNextTurn(currIdx + 1);
  }, 3500);
}

function broadcastSyncState() {
  sendNetworkMsg({ type: "STATE_SYNC", state: gameState });
  updateUI();
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
// UI И ЧАТ
// -------------------------------------------------------------

function updateUI() {
  const playerList = document.getElementById("containerGamePlayers");
  playerList.innerHTML = "";

  gameState.players.forEach(p => {
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

    // Скин игрока 48x48
    const avHolder = document.createElement("div");
    avHolder.className = "player-avatar-holder";

    const col = document.createElement("div"); col.className = "color";
    const eye = document.createElement("div"); eye.className = "eyes";
    const mou = document.createElement("div"); mou.className = "mouth";

    setSpriteStyle(col, p.avatar[0], 48);
    setSpriteStyle(eye, p.avatar[1], 48);
    setSpriteStyle(mou, p.avatar[2], 48);

    avHolder.appendChild(col);
    avHolder.appendChild(eye);
    avHolder.appendChild(mou);

    const info = document.createElement("div");
    info.style.cssText = "margin-left: 8px; flex: 1; line-height: 1.2;";
    info.innerHTML = `
      <div style="font-weight: bold; font-size: 13px;">${escapeHtml(p.name)} ${p.id === gameState.currentDrawerId ? "✏️" : ""}</div>
      <div style="font-size: 12px; color: #5cb85c; font-weight: bold;">${p.score} очков</div>
    `;

    card.appendChild(avHolder);
    card.appendChild(info);
    playerList.appendChild(card);
  });

  // Верхняя панель
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

  // ТУЛБАР: ПОКАЗЫВАЕТСЯ ТОЛЬКО ТОМУ, КТО РИСУЕТ!
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
        sendNetworkMsg({ type: "WORD_CHOSEN", word: w });
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
    processGuess(myPlayerId, text);
  } else {
    sendNetworkMsg({ type: "CHAT_GUESS", text: text });
    addChatMessage(myState.name, text, "normal");
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
