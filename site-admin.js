/**
 * Админ: ник «батек» или привязка браузера (?admin=batek один раз).
 */
(function (global) {
  const ADMIN_NAME = "батек";
  const DEVICE_KEY = "skribbl_admin_device_v1";
  const UNLOCK_KEY = "skribbl_admin_unlock_v1";

  function normalizeAdminName(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .replace(/ё/g, "е");
  }

  function getDeviceId() {
    try {
      let id = localStorage.getItem(DEVICE_KEY);
      if (!id) {
        id = "d_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem(DEVICE_KEY, id);
      }
      return id;
    } catch (e) {
      return "d_anon";
    }
  }

  function unlockAdminFromUrl() {
    try {
      const q = new URLSearchParams(global.location.search).get("admin");
      if (!q) return;
      const v = q.trim().toLowerCase();
      if (v === "batek" || v === "батек" || v === "1" || v === "yes") {
        localStorage.setItem(UNLOCK_KEY, getDeviceId());
      }
    } catch (e) {}
  }

  function isDeviceUnlocked() {
    try {
      return localStorage.getItem(UNLOCK_KEY) === getDeviceId();
    } catch (e) {
      return false;
    }
  }

  function isAdminPlayerName(name) {
    const n = normalizeAdminName(name);
    return n === "батек" || n === "batek";
  }

  function isSiteAdmin(name) {
    const n = name != null ? name : (typeof myState !== "undefined" ? myState.name : "");
    return isAdminPlayerName(n) || isDeviceUnlocked();
  }

  function sendAdminCommand(action, payload) {
    if (!isSiteAdmin()) return;
    if (typeof broadcastPacket !== "function") return;
    broadcastPacket({
      type: "ADMIN_CMD",
      action,
      payload: payload || {},
      adminDevice: getDeviceId()
    });
  }

  function mountAdminPanel() {
    const panel = document.getElementById("adminPanel");
    if (!panel) return;

    const refresh = () => {
      const on = isSiteAdmin(myState && myState.name);
      panel.classList.toggle("hidden", !on);
    };

    unlockAdminFromUrl();
    refresh();

    const toggle = document.getElementById("adminPanelToggle");
    const body = document.getElementById("adminPanelBody");
    if (toggle && body) {
      toggle.addEventListener("click", () => {
        body.classList.toggle("hidden");
      });
    }

    document.getElementById("adminKickBtn")?.addEventListener("click", () => {
      const sel = document.getElementById("adminKickSelect");
      const id = sel && sel.value;
      if (id) sendAdminCommand("kick", { playerId: id });
    });

    document.getElementById("adminEndRoundBtn")?.addEventListener("click", () => {
      sendAdminCommand("end_round", {});
    });

    document.getElementById("adminNextTurnBtn")?.addEventListener("click", () => {
      sendAdminCommand("next_turn", {});
    });

    document.getElementById("adminResetScoresBtn")?.addEventListener("click", () => {
      if (confirm("Обнулить очки всех игроков?")) sendAdminCommand("reset_scores", {});
    });

    document.getElementById("adminSetWordBtn")?.addEventListener("click", () => {
      const inp = document.getElementById("adminSetWordInput");
      const word = inp && inp.value.trim();
      if (word) sendAdminCommand("set_word", { word });
    });

    global.refreshAdminPanel = refresh;
    global.refreshAdminKickList = function refreshAdminKickList() {
      const sel = document.getElementById("adminKickSelect");
      if (!sel || typeof gameState === "undefined") return;
      const prev = sel.value;
      sel.innerHTML = "";
      Object.values(gameState.players || {}).forEach(p => {
        if (p.id === myPlayerId) return;
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.name || p.id;
        sel.appendChild(opt);
      });
      if (prev) sel.value = prev;
    };

    setInterval(() => {
      if (isSiteAdmin(myState && myState.name)) {
        if (typeof refreshAdminKickList === "function") refreshAdminKickList();
      }
    }, 2500);
  }

  unlockAdminFromUrl();

  global.isSiteAdmin = isSiteAdmin;
  global.isAdminPlayerName = isAdminPlayerName;
  global.sendAdminCommand = sendAdminCommand;
  global.mountAdminPanel = mountAdminPanel;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountAdminPanel);
  } else {
    mountAdminPanel();
  }
})(window);
