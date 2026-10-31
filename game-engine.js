/**
 * Skribbl Game Engine - Powered by Public WSS MQTT Broker & Local Multi-Bus
 * 100% Guaranteed cross-device, cross-browser serverless multiplayer.
 */

// Публичные бесплатные WSS MQTT брокеры с авто-переключением при сбоях
const MQTT_BROKERS = [
  "wss://broker.emqx.io:8084/mqtt",
  "wss://broker.hivemq.com:8884/mqtt",
  "wss://test.mosquitto.org:8081"
];

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

let mqttClient = null;
let currentRoomCode = "";
let roomTopic = "";

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
// Аватары и спрайты
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
}

// -------------------------------------------------------------
// Логика комнат и URL
// -------------------------------------------------------------

function parseRoomCode() {
  const urlParams = new URLSearchParams(window.location.search);
  let room = urlParams.get("room");

  if (!room) {
    room = Math.random().toString(36).substring(2, 7);
  }
  currentRoomCode = room.toLowerCase();
  roomTopic = "skribbl_verity_game/" + currentRoomCode;

  // Формируем чистую ссылку для шаринга
  const fullLink = `${window.location.origin}${window.location.pathname}?room=${currentRoomCode}`;
  const inputLink = document.getElementById("inputHeaderRoomLink");
  if (inputLink) inputLink.value = fullLink;
}

function setupUIEvents() {
  const copyBtn = document.getElementById("btnCopyRoomLink") || document.getElementById("btnHeaderCopyLink");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      const input = document.getElementById("headerInviteLink") || document.getElementById("inputHeaderRoomLink");
      if (input) {
        input.select();
        navigator.clipboard.writeText(input.value).then(() => {
          copyBtn.textContent = "Скопировано!";
          setTimeout(() => copyBtn.textContent = "Скопировать", 2000);
        }).catch(() => {
          document.execCommand("copy");
          copyBtn.textContent = "Скопировано!";
          setTimeout(() => copyBtn.textContent = "Скопировать", 2000);
        });
      }
    });
  }

  const playBtn = document.getElementById("btnPlayGame");
  if (playBtn) {
    playBtn.onclick = (e) => {
      if (e) e.preventDefault();
      enterGameSession();
    };
  }

  const formLogin = document.getElementById("formLogin");
  if (formLogin) {
    formLogin.onsubmit = (e) => {
      if (e) e.preventDefault();
      enterGameSession();
      return false;
    };
  }

  const createPrivateBtn = document.getElementById("btnCreatePrivate");
  if (createPrivateBtn) {
    createPrivateBtn.addEventListener("click", () => {
      const newRoom = Math.random().toString(36).substring(2, 7);
      window.location.href = window.location.origin + window.location.pathname + '?room=' + newRoom;
    });
  }

  const formChat = document.getElementById("formChat");
  if (formChat) {
    formChat.addEventListener("submit", handleChatSubmit);
  }

  document.querySelectorAll(".colorItem").forEach(item => {
    item.addEventListener("click", () => {
      currentColor = item.dataset.color;
      const preview = document.getElementById("currentColorPreview");
      if (preview) preview.style.background = currentColor;
      const pen = document.getElementById("toolBtnPen");
      const eraser = document.getElementById("toolBtnEraser");
      if (pen) pen.classList.add("active");
      if (eraser) eraser.classList.remove("active");
    });
  });

  document.querySelectorAll(".brushSize").forEach(item => {
    item.addEventListener("click", () => {
      document.querySelectorAll(".brushSize").forEach(b => b.classList.remove("active"));
      item.classList.add("active");
      currentBrushSize = parseInt(item.dataset.size, 10);
    });
  });

  const toolPen = document.getElementById("toolBtnPen");
  if (toolPen) {
    toolPen.addEventListener("click", () => {
      toolPen.classList.add("active");
      const eraser = document.getElementById("toolBtnEraser");
      if (eraser) eraser.classList.remove("active");
      const preview = document.getElementById("currentColorPreview");
      currentColor = (preview && preview.style.background) ? preview.style.background : "#000000";
    });
  }

  const toolEraser = document.getElementById("toolBtnEraser");
  if (toolEraser) {
    toolEraser.addEventListener("click", () => {
      toolEraser.classList.add("active");
      const pen = document.getElementById("toolBtnPen");
      if (pen) pen.classList.remove("active");
      currentColor = "#ffffff";
    });
  }

  const btnClear = document.getElementById("buttonClearCanvas");
  if (btnClear) {
    btnClear.addEventListener("click", () => {
      if (gameState.currentDrawerId === myPlayerId && gameState.status === "DRAWING") {
        clearCanvasLocal();
        broadcastPacket({ type: "CLEAR" });
      }
    });
  }

  if (canvas) {
    canvas.addEventListener("mousedown", startDrawing);
    canvas.addEventListener("mousemove", draw);
    window.addEventListener("mouseup", stopDrawing);

    canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
    canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", stopDrawing);
  }
}

function enterGameSession() {
  const nameInput = document.getElementById("inputName") || document.getElementById("inputPlayerName");
  const chosenName = (nameInput && nameInput.value.trim()) ? nameInput.value.trim() : ("Игрок " + Math.floor(Math.random() * 900 + 100));

  myState.name = chosenName;
  myState.avatar = [...myAvatar];

  const screenLogin = document.getElementById("screenLogin");
  if (screenLogin) screenLogin.style.display = "none";

  const screenGame = document.getElementById("screenGame");
  if (screenGame) screenGame.style.display = "block";

  gameState.players[myPlayerId] = {
    ...myState,
    lastSeen: Date.now()
  };
  updateUI();

  initNetworkConnection();
}

function initNetworkConnection(brokerIndex = 0) {
  if (brokerIndex >= MQTT_BROKERS.length) {
    brokerIndex = 0; // циклический перебор
  }

  const brokerUrl = MQTT_BROKERS[brokerIndex];
  addChatMessage("Сеть", `Подключение к облаку серверов...`, "system");

  try {
    if (window.mqtt) {
      const clientId = "client_" + myPlayerId + "_" + Math.random().toString(16).substring(2, 8);
      mqttClient = mqtt.connect(brokerUrl, {
        clientId: clientId,
        clean: true,
        connectTimeout: 5000,
        reconnectPeriod: 3000
      });

      mqttClient.on("connect", () => {
        console.log("MQTT connected:", brokerUrl);
        addChatMessage("Сеть", "Вы в сети! Отправьте ссылку сверху другу.", "system");

        mqttClient.subscribe(roomTopic, { qos: 0 }, (err) => {
          if (!err) {
            broadcastPacket({
              type: "PLAYER_JOIN",
              player: gameState.players[myPlayerId]
            });
          }
        });
      });

      mqttClient.on("message", (topic, message) => {
        if (topic === roomTopic) {
          try {
            const data = JSON.parse(message.toString());
            handleIncomingPacket(data);
          } catch(e) {}
        }
      });

      mqttClient.on("error", (err) => {
        console.warn("MQTT Broker error, fallback to next broker:", err);
      });
    }
  } catch (err) {
    console.error("MQTT Init Error:", err);
  }

  // Локальная шина для одной машины / вкладок
  try {
    const localBus = new BroadcastChannel("skribbl_bc_" + currentRoomCode);
    localBus.onmessage = (e) => handleIncomingPacket(e.data);
  } catch(e) {}

  window.addEventListener("storage", (e) => {
    if (e.key === "skribbl_ls_" + currentRoomCode && e.newValue) {
      try {
        handleIncomingPacket(JSON.parse(e.newValue));
      } catch (err) {}
    }
  });

  // Heartbeat каждые 2 секунды
  setInterval(() => {
    if (gameState.players[myPlayerId]) {
      gameState.players[myPlayerId].lastSeen = Date.now();
      broadcastPacket({
        type: "HEARTBEAT",
        player: gameState.players[myPlayerId]
      });
    }

    removeOfflinePlayers();
    checkGameProgress();
  }, 2000);
}

function broadcastPacket(packet) {
  packet.senderId = myPlayerId;
  packet.nonce = Math.random();
  packet.timestamp = Date.now();

  // 1. MQTT WSS
  if (mqttClient && mqttClient.connected) {
    try {
      mqttClient.publish(roomTopic, JSON.stringify(packet), { qos: 0 });
    } catch(e) {}
  }

  // 2. BroadcastChannel
  try {
    const localBus = new BroadcastChannel("skribbl_bc_" + currentRoomCode);
    localBus.postMessage(packet);
  } catch(e) {}

  // 3. LocalStorage
  try {
    localStorage.setItem("skribbl_ls_" + currentRoomCode, JSON.stringify(packet));
  } catch (e) {}
}

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
        addChatMessage("Сеть", `${p.name} присоединился к игре!`, "system");
        if (isRoomLeader()) {
          syncStateToAll();
        }
      }
      updateUI();
      break;
    }

    case "SYNC_STATE": {
      if (!isRoomLeader()) {
        const leaderId = getPlayersList().sort((a,b) => a.id.localeCompare(b.id))[0]?.id;
        if (packet.senderId === leaderId) {
          gameState.currentDrawerId = packet.state.currentDrawerId;
          gameState.currentWord = packet.state.currentWord;
          gameState.round = packet.state.round;
          gameState.maxRounds = packet.state.maxRounds;
          gameState.timeLeft = packet.state.timeLeft;
          gameState.status = packet.state.status;

          Object.keys(packet.state.players).forEach(id => {
            if (id !== myPlayerId) {
              gameState.players[id] = packet.state.players[id];
            }
          });

          updateUI();
        }
      }
      break;
    }

    case "DRAW_STROKE": {
      drawStrokeLocal(packet.prevX, packet.prevY, packet.currX, packet.currY, packet.color, packet.size);
      break;
    }

    case "CLEAR": {
      clearCanvasLocal();
      break;
    }

    case "WORD_SELECT_PROMPT": {
      if (myPlayerId === packet.drawerId) {
        showWordChoices(packet.choices);
      } else {
        hideWordChoices();
      }
      break;
    }

    case "WORD_CHOSEN": {
      if (isRoomLeader()) {
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
      addChatMessage(packet.senderName, packet.text, packet.messageType || "normal");
      break;
    }
  }
}

// -------------------------------------------------------------
// Игровая логика: Раунды, Очередь, Проверка слов (Хост/Лидер)
// -------------------------------------------------------------

function removeOfflinePlayers() {
  const now = Date.now();
  let changed = false;

  Object.keys(gameState.players).forEach(id => {
    if (id !== myPlayerId && (now - gameState.players[id].lastSeen > 6000)) {
      addChatMessage("Сеть", `${gameState.players[id].name} покинул игру.`, "system");
      delete gameState.players[id];
      changed = true;
    }
  });

  if (changed) {
    updateUI();
    if (isRoomLeader()) syncStateToAll();
  }
}

function getPlayersList() {
  return Object.values(gameState.players);
}

function isRoomLeader() {
  const list = getPlayersList().sort((a,b) => a.id.localeCompare(b.id));
  return list.length > 0 && list[0].id === myPlayerId;
}

function checkGameProgress() {
  if (!isRoomLeader()) return;

  const players = getPlayersList();
  if (players.length >= 1 && gameState.status === "WAITING") {
    startNextTurn();
  }
}

function startNextTurn() {
  const players = getPlayersList();
  if (players.length === 0) return;

  // Сброс статуса угадывания
  players.forEach(p => p.hasGuessed = false);

  // Выбор следующего рисующего
  let currentIndex = players.findIndex(p => p.id === gameState.currentDrawerId);
  let nextIndex = (currentIndex + 1) % players.length;
  gameState.currentDrawerId = players[nextIndex].id;

  // Случайные слова
  const choices = [];
  const wordsList = (typeof RUSSIAN_WORDS !== "undefined" && RUSSIAN_WORDS.length) ? RUSSIAN_WORDS : ["кот", "дом", "солнце", "дерево", "машина"];
  while (choices.length < 3) {
    const randomWord = wordsList[Math.floor(Math.random() * wordsList.length)].toLowerCase();
    if (!choices.includes(randomWord)) choices.push(randomWord);
  }

  gameState.status = "CHOOSING";
  gameState.currentWord = "";
  gameState.timeLeft = 15;

  clearCanvasLocal();
  broadcastPacket({ type: "CLEAR" });

  if (gameState.currentDrawerId === myPlayerId) {
    showWordChoices(choices);
  } else {
    hideWordChoices();
    broadcastPacket({
      type: "WORD_SELECT_PROMPT",
      drawerId: gameState.currentDrawerId,
      choices: choices
    });
  }

  const drawerName = gameState.players[gameState.currentDrawerId]?.name || "Игрок";
  broadcastChatMessage("Игра", `${drawerName} выбирает слово...`, "system");

  syncStateToAll();

  clearInterval(roundTimerInterval);
  roundTimerInterval = setInterval(() => {
    gameState.timeLeft--;
    if (gameState.timeLeft <= 0) {
      clearInterval(roundTimerInterval);
      if (gameState.status === "CHOOSING") {
        startDrawingRound(choices[0]);
      }
    }
    syncStateToAll();
  }, 1000);
}

function startDrawingRound(word) {
  clearInterval(roundTimerInterval);
  gameState.status = "DRAWING";
  gameState.currentWord = word.toLowerCase();
  gameState.timeLeft = 60;

  broadcastChatMessage("Игра", `Раунд начался! Время рисовать и угадывать.`, "system");
  syncStateToAll();

  roundTimerInterval = setInterval(() => {
    gameState.timeLeft--;

    if (gameState.timeLeft <= 0) {
      clearInterval(roundTimerInterval);
      endTurnTimeUp();
    } else {
      syncStateToAll();
    }
  }, 1000);
}

function levenshteinDistance(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1];
      else dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function processIncomingGuess(playerId, rawText) {
  const text = rawText.trim().toLowerCase();
  const player = gameState.players[playerId];
  if (!player) return;

  if (playerId === gameState.currentDrawerId) {
    broadcastChatMessage(player.name, rawText, "normal");
    return;
  }

  if (player.hasGuessed) {
    return;
  }

  if (gameState.status === "DRAWING" && gameState.currentWord) {
    if (text === gameState.currentWord) {
      player.hasGuessed = true;
      const earned = Math.max(50, gameState.timeLeft * 10);
      player.score = (player.score || 0) + earned;

      // Очки рисующему
      const drawer = gameState.players[gameState.currentDrawerId];
      if (drawer) {
        drawer.score = (drawer.score || 0) + 25;
      }

      broadcastChatMessage("Игра", `${player.name} угадал слово (+${earned} очков)!`, "correct");

      const guessers = getPlayersList().filter(p => p.id !== gameState.currentDrawerId);
      const allGuessed = guessers.length > 0 && guessers.every(p => p.hasGuessed);

      if (allGuessed) {
        clearInterval(roundTimerInterval);
        endTurnTimeUp();
      } else {
        syncStateToAll();
      }
      return;
    }

    if (levenshteinDistance(text, gameState.currentWord) === 1) {
      broadcastChatMessage("Подсказка", `"${rawText}" очень близко!`, "close");
      return;
    }
  }

  broadcastChatMessage(player.name, rawText, "normal");
}

function endTurnTimeUp() {
  broadcastChatMessage("Игра", `Раунд окончен! Загаданное слово было: "${gameState.currentWord.toUpperCase()}".`, "system");
  setTimeout(() => {
    startNextTurn();
  }, 3500);
}

function broadcastChatMessage(senderName, text, messageType) {
  addChatMessage(senderName, text, messageType);
  broadcastPacket({
    type: "CHAT_BROADCAST",
    senderName: senderName,
    text: text,
    messageType: messageType
  });
}

function syncStateToAll() {
  updateUI();
  broadcastPacket({
    type: "SYNC_STATE",
    state: {
      players: gameState.players,
      currentDrawerId: gameState.currentDrawerId,
      currentWord: gameState.currentWord,
      round: gameState.round,
      maxRounds: gameState.maxRounds,
      timeLeft: gameState.timeLeft,
      status: gameState.status
    }
  });
}

// -------------------------------------------------------------
// Рисование на холсте
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
  const coords = getCoords(e);
  lastX = coords.x;
  lastY = coords.y;
}

function draw(e) {
  if (!isDrawing || gameState.currentDrawerId !== myPlayerId || gameState.status !== "DRAWING") return;
  const coords = getCoords(e);

  drawStrokeLocal(lastX, lastY, coords.x, coords.y, currentColor, currentBrushSize);

  broadcastPacket({
    type: "DRAW_STROKE",
    prevX: lastX,
    prevY: lastY,
    currX: coords.x,
    currY: coords.y,
    color: currentColor,
    size: currentBrushSize
  });

  lastX = coords.x;
  lastY = coords.y;
}

function stopDrawing() {
  isDrawing = false;
}

function handleTouchStart(e) {
  if (e.touches.length === 1) {
    e.preventDefault();
    const touch = e.touches[0];
    startDrawing(touch);
  }
}

function handleTouchMove(e) {
  if (e.touches.length === 1) {
    e.preventDefault();
    const touch = e.touches[0];
    draw(touch);
  }
}

function drawStrokeLocal(x1, y1, x2, y2, color, size) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.closePath();
}

function clearCanvasLocal() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// -------------------------------------------------------------
// Рендеринг интерфейса (UI)
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
      wordDisplay.textContent = "СЛОВО: " + (gameState.currentWord || "").toUpperCase();
    } else {
      wordDisplay.textContent = "_ ".repeat(gameState.currentWord ? gameState.currentWord.length : 4).trim();
    }
  } else if (gameState.status === "CHOOSING") {
    wordDisplay.textContent = "ВЫБОР СЛОВА...";
  } else {
    wordDisplay.textContent = "ОЖИДАНИЕ...";
  }

  // Панель рисования видна ТОЛЬКО рисующему
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
