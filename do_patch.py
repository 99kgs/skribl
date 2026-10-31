import os

with open(r'C:\Users\User\Desktop\skribbl-game\game-engine.js', 'r', encoding='utf-8') as f:
    js = f.read()

pos1 = js.find('function setupUIEvents()')
pos2 = js.find('function initNetworkConnection(')

new_code = """function setupUIEvents() {
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

"""

res = js[:pos1] + new_code + js[pos2:]
with open(r'C:\Users\User\Desktop\skribbl-game\game-engine.js', 'w', encoding='utf-8') as f:
    f.write(res)
print("PATCH COMPLETED!")
