(() => {
  const container = document.getElementById("flashContainer");
  const overlayStatus = document.getElementById("overlayStatus");
  const statusLine = document.getElementById("statusLine");
  const fileInput = document.getElementById("swfFile");
  const urlInput = document.getElementById("swfUrl");
  const loadBtn = document.getElementById("loadBtn");
  const clearBtn = document.getElementById("clearBtn");
  const pad = document.getElementById("virtualPad");
  const padToggle = document.getElementById("togglePad");
  const localLoadBtn = document.getElementById("localLoadBtn");
  const localSearch = document.getElementById("localSearch");
  const localSelect = document.getElementById("localSelect");
  const localPlayBtn = document.getElementById("localPlayBtn");
  const localStatus = document.getElementById("localStatus");
  const fullscreenBtn = document.getElementById("flashFullscreen");
  const playerFrame = document.getElementById("playerFrame");

  let currentObjectUrl = null;
  let player = null;
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|Windows Phone/i.test(
    navigator.userAgent || ""
  );
  const isSmallScreen = window.matchMedia("(max-width: 768px)").matches;
  let padEnabled = false;
  const LOCAL_BASE = "./local-games/flash/";
  let localList = [];
  let localFiltered = [];
  let statusTimer = null;

  function setStatus(text, { persist = false, timeout = 1500 } = {}) {
    if (statusTimer) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }
    if (statusLine) statusLine.textContent = text || "";
    if (overlayStatus) {
      overlayStatus.textContent = text || "";
      overlayStatus.classList.toggle("visible", !!text);
    }
    if (text && !persist && timeout > 0) {
      statusTimer = setTimeout(() => {
        statusTimer = null;
        setStatus("");
      }, timeout);
    }
  }

  function releaseObjectUrl() {
    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    }
  }

  function clearPlayer() {
    releaseObjectUrl();
    if (player && player.remove) {
      try {
        player.remove();
      } catch (_) {}
    }
    player = null;
    if (container) container.innerHTML = "";
  }

  function toKeyPayload(code) {
    if (code === "Space") return { key: " ", code };
    if (code.startsWith("Key")) {
      const letter = code.slice(3);
      return { key: letter.toLowerCase(), code };
    }
    return { key: code, code };
  }

  function dispatchKey(code, type) {
    const payload = toKeyPayload(code);
    const evt = new KeyboardEvent(type, {
      key: payload.key,
      code: payload.code,
      bubbles: true,
    });
    document.dispatchEvent(evt);
  }

  function bindPadButtons() {
    if (!pad) return;
    const buttons = pad.querySelectorAll("[data-key]");
    buttons.forEach((btn) => {
      const code = btn.dataset.key;
      const press = (ev) => {
        ev.preventDefault();
        dispatchKey(code, "keydown");
        btn.classList.add("is-active");
      };
      const release = (ev) => {
        ev.preventDefault();
        dispatchKey(code, "keyup");
        btn.classList.remove("is-active");
      };
      btn.addEventListener("pointerdown", press);
      btn.addEventListener("pointerup", release);
      btn.addEventListener("pointercancel", release);
      btn.addEventListener("pointerleave", release);
    });
  }

  async function ensureRuffle() {
    if (window.RufflePlayer && typeof window.RufflePlayer.newest === "function") {
      return window.RufflePlayer.newest();
    }
    throw new Error("Khong tai duoc Ruffle. Kiem tra CDN.");
  }

  async function loadGame(sourceUrl, label) {
    if (!sourceUrl) {
      setStatus("Chon file hoac nhap URL SWF truoc.", { persist: true });
      return;
    }
    try {
      setStatus("Dang nap game...", { persist: true });
      const ruffle = await ensureRuffle();
      if (!container) throw new Error("Khong tim thay khung player.");
      container.innerHTML = "";
      player = ruffle.createPlayer();
      player.style.width = "100%";
      player.style.height = "100%";
      container.appendChild(player);
      player.load({ url: sourceUrl }).then(
        () => setStatus(`Da nap: ${label || "SWF"}`),
        (err) => {
          console.error(err);
          setStatus("Khong tai duoc SWF (co the do CORS hoac file hong).", {
            persist: true,
          });
        }
      );
    } catch (err) {
      console.error(err);
      setStatus("Loi nap game: " + (err?.message || err), { persist: true });
    }
  }

  function handleLoad() {
    const file = fileInput?.files?.[0];
    const urlValue = (urlInput?.value || "").trim();

    clearPlayer();

    if (file) {
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      if (ext !== "swf") {
        setStatus("File khong phai .swf.");
        return;
      }
      currentObjectUrl = URL.createObjectURL(file);
      loadGame(currentObjectUrl, file.name);
      return;
    }

    if (urlValue) {
      loadGame(urlValue, urlValue);
      return;
    }

    setStatus("Hay chon file hoac nhap URL SWF.");
  }

  function handleClear() {
    clearPlayer();
    if (fileInput) fileInput.value = "";
    if (urlInput) urlInput.value = "";
    setStatus("Da xoa cau hinh. Chon game de chay.");
  }

  async function loadLocalList() {
    if (localLoadBtn) localLoadBtn.disabled = true;
    if (localStatus) localStatus.textContent = "Dang tai danh sach offline...";
    try {
      const res = await fetch(`${LOCAL_BASE}index.json`, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json)) throw new Error("File index khong hop le.");
      localList = json.map((item, idx) => ({
        id: idx,
        title: item.title || item.name || item.file || `Game ${idx + 1}`,
        file: item.file || item.path || "",
      })).filter((it) => it.file);
      localFiltered = [...localList];
      renderLocalList();
      if (localStatus) localStatus.textContent = "Da tai danh sach offline.";
    } catch (err) {
      console.error(err);
      if (localStatus) localStatus.textContent = "Khong tai duoc index offline.";
    } finally {
      if (localLoadBtn) localLoadBtn.disabled = false;
    }
  }

  function renderLocalList() {
    if (!localSelect) return;
    localSelect.innerHTML = "";
    localFiltered.forEach((item) => {
      const opt = document.createElement("option");
      opt.value = String(item.id);
      opt.textContent = item.title;
      localSelect.appendChild(opt);
    });
    const hasData = localFiltered.length > 0;
    localSelect.disabled = !hasData;
    if (localPlayBtn) localPlayBtn.disabled = !hasData;
    if (localSearch) localSearch.disabled = !localList.length;
  }

  function handleLocalSearch(e) {
    const q = (e.target.value || "").toLowerCase();
    localFiltered = localList.filter((item) =>
      item.title.toLowerCase().includes(q)
    );
    renderLocalList();
  }

  function handleLocalPlay() {
    if (!localSelect || !localFiltered.length) {
      setStatus("Chua nap danh sach offline.");
      return;
    }
    const id = Number(localSelect.value);
    const entry = localList.find((it) => it.id === id);
    if (!entry) {
      setStatus("Chua chon game offline.");
      return;
    }
    const filePath = entry.file || "";
    const normalized =
      /^https?:\/\//i.test(filePath) || filePath.startsWith("/")
        ? filePath
        : filePath.startsWith("local-games/flash/")
        ? `./${filePath}`
        : `${LOCAL_BASE}${filePath}`;
    const url = normalized.replace(/\\/g, "/");
    setStatus(`Dang nap ${entry.title}...`);
    loadGame(url, entry.title);
  }

  function applyPadVisibility() {
    if (!pad) return;
    pad.classList.toggle("is-hidden", !padEnabled);
    if (padToggle) {
      padToggle.textContent = `Pad ao: ${padEnabled ? "Bat" : "Tat"}`;
      padToggle.style.display = "none";
    }
  }

  function initPad() {
    bindPadButtons();
    applyPadVisibility();
    if (padToggle) {
      padToggle.addEventListener("click", () => {
        padEnabled = !padEnabled;
        applyPadVisibility();
      });
    }
  }

  if (loadBtn) loadBtn.addEventListener("click", handleLoad);
  if (clearBtn) clearBtn.addEventListener("click", handleClear);
  if (localLoadBtn) localLoadBtn.addEventListener("click", loadLocalList);
  if (localSearch) localSearch.addEventListener("input", handleLocalSearch);
  if (localPlayBtn) localPlayBtn.addEventListener("click", handleLocalPlay);
  if (fullscreenBtn) {
    const updateFsLabel = () => {
      const active = !!document.fullscreenElement;
      fullscreenBtn.textContent = active ? "×" : "⛶";
      fullscreenBtn.setAttribute(
        "aria-label",
        active ? "Thoat toan man hinh" : "Toan man hinh"
      );
    };
    fullscreenBtn.addEventListener("click", () => {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else if (playerFrame?.requestFullscreen) {
        playerFrame.requestFullscreen().catch(() => {});
      }
    });
    document.addEventListener("fullscreenchange", updateFsLabel);
    updateFsLabel();
  }

  loadLocalList();
  initPad();
  setStatus("Chua nap game.");
})();
