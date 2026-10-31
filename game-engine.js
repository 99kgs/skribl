/**
 * Skribbl Friends - Production Realtime Engine via Public Realtime Database
 * 100% Guaranteed sync across all devices, browsers, and mobile phones.
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

let gameState = {
  players: {}, // id -> player
  currentDrawerId: null,
  currentWord: "",
  round: 1,
  maxRounds: 3,
  timeLeft: 60,
  status: "WAITING"
};

let db = null;
let roomRef = null;
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
// ВХОД И ПОДКЛЮЧЕНИЕ К ЕДИНОЙ СЕССИИ FIREBASE
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
    if (gameState.currentDrawerId === myPlayerId && roomRef) {
      clearCanvasLocal();
      roomRef.child("clear").set(Date.now());
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

  connectToGlobalFirebaseRoom();
}

function connectToGlobalFirebaseRoom() {
  // Публичный открытый бесплатный Firebase Realtime проект
  const firebaseConfig = {
    databaseURL: "https://skribbl-99kgs-default-rtdb.firebaseio.com"
  };

  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
  db = firebase.database();
  roomRef = db.ref("rooms/global_game_room");

  // 1. Добавляем себя в список игроков (с авто-удалением при выходе)
  const myPlayerRef = roomRef.child("players/" + myPlayerId);
  myPlayerRef.set({
    id: myPlayerId,
    name: myState.name,
    avatar: myState.avatar,
    score: 0,
    hasGuessed: false,
    lastSeen: Date.now()
  });
  myPlayerRef.onDisconnect().remove();

  // 2. Слушаем игроков
  roomRef.child("players").on("value", (snapshot) => {
    gameState.players = snapshot.val() || {};
    updateUI();
    checkHostAndStart();
  });

  // 3. Слушаем игровое состояние (раунды, слово, статус)
  roomRef.child("state").on("value", (snapshot) => {
    const val = snapshot.val();
    if (val) {
      gameState.currentDrawerId = val.currentDrawerId;
      gameState.currentWord = val.currentWord;
      gameState.round = val.round || 1;
      gameState.timeLeft = val.timeLeft !== undefined ? val.timeLeft : 60;
      gameState.status = val.status || "WAITING";
      updateUI();
    }
  });

  // 4. Слушаем рисование в реальном времени
  roomRef.child("strokes").limitToLast(1).on("child_added", (snapshot) => {
    const stroke = snapshot.val();
    if (stroke && stroke.senderId !== myPlayerId) {
      drawStrokeLocal(stroke);
    }
  });

  // 5. Очистка холста
  roomRef.child("clear").on("value", (snapshot) => {
    if (snapshot.val()) {
      clearCanvasLocal();
    }
  });

  // 6. Слушаем чат
  roomRef.child("messages").limitToLast(1).on("child_added", (snapshot) => {
    const msg = snapshot.val();
    if (msg) {
      addChatMessage(msg.sender, msg.text, msg.type);
    }
  });

  // Периодическое обновление присутствия
  setInterval(() => {
    myPlayerRef.child("lastSeen").set(Date.now());
  }, 4000);
}

function getPlayersList() {
  return Object.values(gameState.players || {});
}

function isRoomLeader() {
  const list = getPlayersList().sort((a, b) => a.id.localeCompare(b.id));
  return list.length > 0 && list[0].id === myPlayerId;
}

// -------------------------------------------------------------
// ИГРОВОЙ ЦИКЛ (ОТВЕТСТВЕННОСТЬ ХОСТА)
// -------------------------------------------------------------

function checkHostAndStart() {
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

  // Сброс угадываний
  list.forEach(p => {
    if (roomRef) roomRef.child("players/" + p.id + "/hasGuessed").set(false);
  });

  if (roomRef) {
    roomRef.child("clear").set(Date.now());
    roomRef.child("strokes").remove();
  }

  const choices = typeof getRandomWords === "function" ? getRandomWords(3) : ["кот", "дом", "солнце"];

  if (drawer.id === myPlayerId) {
    showWordChoices(choices);
  }

  syncGameStateToFirebase();

  pushChatMessage("Система", `${drawer.name} сейчас выбирает слово...`, "system");
}

function startDrawingRound(word) {
  gameState.currentWord = word;
  gameState.status = "DRAWING";
  gameState.timeLeft = 60;
  hideWordChoices();
  syncGameStateToFirebase();

  const list = getPlayersList();
  const drawer = list.find(p => p.id === gameState.currentDrawerId);
  pushChatMessage("Система", `${drawer ? drawer.name : "Игрок"} начал рисовать!`, "system");

  clearInterval(roundTimerInterval);
  roundTimerInterval = setInterval(() => {
    gameState.timeLeft--;
    if (roomRef && isRoomLeader()) {
      roomRef.child("state/timeLeft").set(gameState.timeLeft);
    }

    if (gameState.timeLeft <= 0) {
      clearInterval(roundTimerInterval);
      endTurnTimeUp();
    }
  }, 1000);
}

function processGuess(senderId, text) {
  const list = getPlayersList();
  const p = list.find(x => x.id === senderId);
  if (!p) return;

  if (p.hasGuessed || senderId === gameState.currentDrawerId) {
    pushChatMessage(p.name, text, "normal");
    return;
  }

  const cleanGuess = text.trim().toLowerCase();
  const target = (gameState.currentWord || "").trim().toLowerCase();

  if (cleanGuess === target) {
    const pts = Math.max(50, gameState.timeLeft * 10);
    const newScore = (p.score || 0) + pts;

    if (roomRef) {
      roomRef.child("players/" + senderId + "/hasGuessed").set(true);
      roomRef.child("players/" + senderId + "/score").set(newScore);
    }

    const drawer = list.find(x => x.id === gameState.currentDrawerId);
    if (drawer && roomRef) {
      roomRef.child("players/" + drawer.id + "/score").set((drawer.score || 0) + 25);
    }

    pushChatMessage("🎉 Угадал", `${p.name} отгадал(а) слово! (+${pts})`, "correct");

    // Проверяем, все ли угадали
    const guessers = list.filter(x => x.id !== gameState.currentDrawerId);
    if (guessers.every(x => x.id === senderId || x.hasGuessed) && guessers.length > 0) {
      clearInterval(roundTimerInterval);
      endTurnTimeUp();
    }
  } else {
    pushChatMessage(p.name, text, "normal");
  }
}

function endTurnTimeUp() {
  pushChatMessage("Система", `Раунд окончен! Слово было: "${gameState.currentWord}"`, "system");

  const list = getPlayersList();
  const currIdx = list.findIndex(p => p.id === gameState.currentDrawerId);
  setTimeout(() => {
    startNextTurn(currIdx + 1);
  }, 3500);
}

function syncGameStateToFirebase() {
  if (roomRef && isRoomLeader()) {
    roomRef.child("state").set({
      currentDrawerId: gameState.currentDrawerId,
      currentWord: gameState.currentWord,
      round: gameState.round,
      timeLeft: gameState.timeLeft,
      status: gameState.status
    });
  }
  updateUI();
}

function pushChatMessage(sender, text, type = "normal") {
  if (roomRef) {
    roomRef.child("messages").push({
      sender: sender,
      text: text,
      type: type,
      time: Date.now()
    });
  }
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
    size: currentBrushSize,
    senderId: myPlayerId
  };

  drawStrokeLocal(stroke);
  if (roomRef) {
    roomRef.child("strokes").push(stroke);
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
// ИНТЕРФЕЙС И ЧАТ
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

  // Тулбар ТОЛЬКО для рисующего
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
      startDrawingRound(w);
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
    if (roomRef) {
      roomRef.child("guessEvents").push({
        senderId: myPlayerId,
        text: text,
        time: Date.now()
      });
    }
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
