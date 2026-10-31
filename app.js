/**
 * Skribbl.io Engine - Reliable BroadcastChannel & Standalone Support
 */

const AVATAR_LIMITS = [28, 57, 51];
let myAvatar = [
  Math.floor(Math.random() * AVATAR_LIMITS[0]),
  Math.floor(Math.random() * AVATAR_LIMITS[1]),
  Math.floor(Math.random() * AVATAR_LIMITS[2]),
  -1
];

const myState = {
  id: "usr_" + Math.random().toString(36).substring(2, 9),
  name: "Player",
  avatar: myAvatar,
  isHost: true,
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

let syncChannel = null;
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
  checkUrlParams();
});

function setSpritePos(el, idx, maxInRow = 10) {
  if (!el) return;
  const x = -(idx % maxInRow) * 100;
  const y = -Math.floor(idx / maxInRow) * 100;
  el.style.backgroundPosition = `${x}% ${y}%`;
}

function updateAvatarUI() {
  const col = document.getElementById("layer-col");
  const eye = document.getElementById("layer-eye");
  const mou = document.getElementById("layer-mou");

  setSpritePos(col, myAvatar[0] % AVATAR_LIMITS[0]);
  setSpritePos(eye, myAvatar[1] % AVATAR_LIMITS[1]);
  setSpritePos(mou, myAvatar[2] % AVATAR_LIMITS[2]);
}

function initAvatarCustomizer() {
  updateAvatarUI();

  // Стрелки влево
  document.querySelectorAll(".avatar-customizer .arrows.left .arrow").forEach(arrow => {
    arrow.addEventListener("click", () => {
      const idx = parseInt(arrow.dataset.avatarIndex, 10);
      myAvatar[idx]--;
      if (myAvatar[idx] < 0) myAvatar[idx] = AVATAR_LIMITS[idx] - 1;
      updateAvatarUI();
    });
  });

  // Стрелки вправо
  document.querySelectorAll(".avatar-customizer .arrows.right .arrow").forEach(arrow => {
    arrow.addEventListener("click", () => {
      const idx = parseInt(arrow.dataset.avatarIndex, 10);
      myAvatar[idx]++;
      if (myAvatar[idx] >= AVATAR_LIMITS[idx]) myAvatar[idx] = 0;
      updateAvatarUI();
    });
  });

  // Кнопка рандомайзера
  document.getElementById("btn-randomize-avatar").addEventListener("click", () => {
    myAvatar[0] = Math.floor(Math.random() * AVATAR_LIMITS[0]);
    myAvatar[1] = Math.floor(Math.random() * AVATAR_LIMITS[1]);
    myAvatar[2] = Math.floor(Math.random() * AVATAR_LIMITS[2]);
    updateAvatarUI();
  });
}

function checkUrlParams() {
  const urlParams = new URLSearchParams(window.location.search);
  const room = urlParams.get("room");
  if (room) {
    document.getElementById("input-direct-code").value = room.toUpperCase();
    document.getElementById("btn-play-action").querySelector("span").textContent = "Join Room!";
  }
}

function setupEventListeners() {
  document.getElementById("btn-play-action").addEventListener("click", handlePlayClick);
  document.getElementById("btn-join-direct").addEventListener("click", joinDirect);
  document.getElementById("btn-start-match").addEventListener("click", startGame);
  document.getElementById("btn-copy-share-link").addEventListener("click", copyInviteLink);
  document.getElementById("game-settings").addEventListener("click", copyInviteLink);

  document.getElementById("skribbl-chat-form").addEventListener("submit", handleChatSubmit);

  // Холст
  canvas.addEventListener("mousedown", startDrawing);
  canvas.addEventListener("mousemove", draw);
  window.addEventListener("mouseup", stopDrawing);

  canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
  canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
  window.addEventListener("touchend", stopDrawing);

  // Цвета
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

  document.getElementById("btn-tool-pen").addEventListener("click", () => {
    currentColor = "#000000";
  });

  document.getElementById("btn-tool-eraser").addEventListener("click", () => {
    currentColor = "#ffffff";
  });

  document.getElementById("btn-tool-clear").addEventListener("click", () => {
    if (myState.id === gameState.currentDrawerId) {
      clearCanvasLocal();
      broadcast({ type: "CANVAS_CLEAR" });
    }
  });
}

function getPlayerName() {
  const val = document.getElementById("input-username").value.trim();
  return val ? val : "Player_" + Math.floor(Math.random() * 1000);
}

function generateRoomCode() {
  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let result = "";
  for (let i = 0; i < 5; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function handlePlayClick() {
  const directCode = document.getElementById("input-direct-code").value.trim().toUpperCase();
  if (directCode) {
    joinRoomWithCode(directCode);
  } else {
    createRoom();
  }
}

function joinDirect() {
  const directCode = document.getElementById("input-direct-code").value.trim().toUpperCase();
  if (!directCode) {
    alert("Please enter a room code!");
    return;
  }
  joinRoomWithCode(directCode);
}

// Создание комнаты: моментальный переход в игру!
function createRoom() {
  myState.name = getPlayerName();
  myState.avatar = [...myAvatar];
  myState.isHost = true;
  const roomCode = generateRoomCode();
  gameState.roomCode = roomCode;

  enterGameScreen();

  gameState.players = [{
    id: myState.id,
    name: myState.name,
    avatar: myState.avatar,
    score: 0,
    hasGuessed: false,
    isHost: true
  }];
  updateUI();

  setupRoomChannel(roomCode);
  addChatMessage({ sender: "System", text: `Room ${roomCode} created! Share the link with friends.`, type: "system" });
}

function joinRoomWithCode(code) {
  myState.name = getPlayerName();
  myState.avatar = [...myAvatar];
  myState.isHost = false;
  gameState.roomCode = code;

  enterGameScreen();
  document.getElementById("game-lobby-waiting-room").style.display = "none";

  setupRoomChannel(code);
  broadcast({
    type: "PLAYER_JOIN",
    player: {
      id: myState.id,
      name: myState.name,
      avatar: myState.avatar
    }
  });
}

// Канал обмена данными
function setupRoomChannel(roomCode) {
  try {
    syncChannel = new BroadcastChannel("skribbl_room_" + roomCode);
    syncChannel.onmessage = (e) => {
      handleIncomingData(e.data);
    };
  } catch(e) {
    console.warn("BroadcastChannel error:", e);
  }
}

function broadcast(msg) {
  if (syncChannel) {
    syncChannel.postMessage(msg);
  }
}

function handleIncomingData(data) {
  switch (data.type) {
    case "PLAYER_JOIN": {
      if (myState.isHost) {
        if (!gameState.players.find(p => p.id === data.player.id)) {
          gameState.players.push({
            id: data.player.id,
            name: data.player.name,
            avatar: data.player.avatar,
            score: 0,
            hasGuessed: false,
            isHost: false
          });
          broadcastState();
          broadcast({
            type: "CHAT_MESSAGE",
            message: { sender: "System", text: `${data.player.name} joined!`, type: "system" }
          });
        }
      }
      break;
    }

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

    case "WORD_CHOSEN":
      if (myState.isHost) {
        startRoundDrawing(data.word);
      }
      break;

    case "CHAT_GUESS":
      if (myState.isHost) {
        processGuess(data.senderId, data.text);
      }
      break;

    case "CHAT_MESSAGE":
      addChatMessage(data.message);
      break;
  }
}

function broadcastState() {
  broadcast({ type: "STATE_SYNC", state: gameState });
  updateUI();
}

function startGame() {
  gameState.round = 1;
  gameState.players.forEach(p => p.score = 0);
  document.getElementById("game-lobby-waiting-room").style.display = "none";
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

  const choices = typeof getRandomWords === "function" ? getRandomWords(3) : ["кот", "дом", "солнце"];

  if (drawer.id === myState.id) {
    showWordPicker(choices);
  }

  broadcastState();
  broadcast({
    type: "CHAT_MESSAGE",
    message: { sender: "System", text: `${drawer.name} is choosing a word...`, type: "system" }
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
    message: { sender: "System", text: `${drawer ? drawer.name : "Player"} is drawing now!`, type: "system" }
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
      message: { sender: "🎉 Guessed", text: `${p.name} guessed the word! (+${pointsAwarded})`, type: "correct" }
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
    message: { sender: "System", text: `Time's up! The word was: "${gameState.currentWord}"`, type: "close" }
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
    message: { sender: "🏆 Game Over", text: `Winner: ${winner ? winner.name : "None"} with ${winner ? winner.score : 0} points!`, type: "correct" }
  });
}

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
  document.getElementById("home").style.display = "none";
  document.getElementById("game").style.display = "flex";

  const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${gameState.roomCode}`;
  document.getElementById("share-link-input").value = inviteUrl;

  clearCanvasLocal();
}

function updateUI() {
  const playersContainer = document.getElementById("game-players-list");
  playersContainer.innerHTML = "";

  gameState.players.forEach((p, idx) => {
    const pCard = document.createElement("div");
    pCard.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      margin-bottom: 4px;
      border-radius: 4px;
      background: ${p.hasGuessed ? "#d1fae5" : (p.id === gameState.currentDrawerId ? "#e0f2fe" : "#f1f5f9")};
      border: 1px solid ${p.hasGuessed ? "#10b981" : "#cbd5e1"};
    `;

    const avWrapper = document.createElement("div");
    avWrapper.style.cssText = "width: 36px; height: 36px; position: relative; flex-shrink: 0;";

    const col = document.createElement("div");
    col.className = "custom-avatar-layer layer-color";
    setSpritePos(col, p.avatar[0] % AVATAR_LIMITS[0]);

    const eye = document.createElement("div");
    eye.className = "custom-avatar-layer layer-eyes";
    setSpritePos(eye, p.avatar[1] % AVATAR_LIMITS[1]);

    const mou = document.createElement("div");
    mou.className = "custom-avatar-layer layer-mouth";
    setSpritePos(mou, p.avatar[2] % AVATAR_LIMITS[2]);

    avWrapper.appendChild(col);
    avWrapper.appendChild(eye);
    avWrapper.appendChild(mou);

    const info = document.createElement("div");
    info.style.cssText = "flex: 1; min-width: 0; line-height: 1.2;";
    info.innerHTML = `
      <div style="font-weight: bold; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
        ${escapeHtml(p.name)} ${p.id === gameState.currentDrawerId ? "✏️" : ""}
      </div>
      <div style="font-size: 12px; color: #53759e; font-weight: 600;">
        ${p.score} points
      </div>
    `;

    pCard.appendChild(avWrapper);
    pCard.appendChild(info);
    playersContainer.appendChild(pCard);
  });

  document.getElementById("game-timer-display").textContent = gameState.timeLeft;
  document.getElementById("game-round-display").textContent = `Round ${gameState.round} of ${gameState.maxRounds}`;

  const wordLabel = document.getElementById("game-word-label");
  const wordDisplay = document.getElementById("game-word-current");
  const isDrawer = (myState.id === gameState.currentDrawerId);

  if (gameState.status === "DRAWING") {
    if (isDrawer) {
      wordLabel.textContent = "DRAW THIS";
      wordDisplay.textContent = (gameState.currentWord || "").toUpperCase();
    } else {
      wordLabel.textContent = "GUESS THIS";
      wordDisplay.textContent = "_ ".repeat(gameState.currentWord ? gameState.currentWord.length : 4).trim();
    }
  } else if (gameState.status === "CHOOSING_WORD") {
    wordLabel.textContent = "CHOOSING WORD...";
    wordDisplay.textContent = "";
  } else {
    wordLabel.textContent = "WAITING...";
    wordDisplay.textContent = "";
  }

  if (gameState.status !== "LOBBY") {
    document.getElementById("game-lobby-waiting-room").style.display = "none";
  }

  const toolbar = document.getElementById("game-toolbar");
  if (isDrawer && gameState.status === "DRAWING") {
    toolbar.style.opacity = "1";
    toolbar.style.pointerEvents = "auto";
  } else {
    toolbar.style.opacity = "0.4";
    toolbar.style.pointerEvents = "none";
  }
}

function showWordPicker(words) {
  const modal = document.getElementById("game-word-picker-custom");
  const container = document.getElementById("word-options-container");
  container.innerHTML = "";

  words.forEach(w => {
    const btn = document.createElement("button");
    btn.textContent = w;
    btn.onclick = () => {
      hideWordPicker();
      startRoundDrawing(w);
    };
    container.appendChild(btn);
  });

  modal.classList.remove("hidden");
}

function hideWordPicker() {
  document.getElementById("game-word-picker-custom").classList.add("hidden");
}

function handleChatSubmit(e) {
  e.preventDefault();
  const input = document.getElementById("skribbl-chat-input");
  const text = input.value.trim();
  if (!text) return;

  if (myState.isHost) {
    processGuess(myState.id, text);
  } else {
    broadcast({ type: "CHAT_GUESS", senderId: myState.id, text: text });
  }

  input.value = "";
}

function addChatMessage(msg) {
  const container = document.getElementById("skribbl-chat-messages");
  const div = document.createElement("div");

  if (msg.type === "system") {
    div.style.cssText = "color: #555; font-style: italic;";
    div.textContent = msg.text;
  } else if (msg.type === "correct") {
    div.style.cssText = "color: #16a34a; font-weight: bold;";
    div.textContent = msg.text;
  } else if (msg.type === "close") {
    div.style.cssText = "color: #d97706; font-weight: bold;";
    div.textContent = msg.text;
  } else {
    div.innerHTML = `<strong>${escapeHtml(msg.sender)}:</strong> ${escapeHtml(msg.text)}`;
  }

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function copyInviteLink() {
  const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${gameState.roomCode}`;
  navigator.clipboard.writeText(inviteUrl).then(() => {
    alert("Invite link copied to clipboard!\n" + inviteUrl);
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
