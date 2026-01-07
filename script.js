(() => {
  const gameHost = document.getElementById("game");
  const statusLine = document.getElementById("statusLine");
  const romFile = document.getElementById("romFile");
  const romUrl = document.getElementById("romUrl");
  const loadBtn = document.getElementById("loadBtn");
  const clearBtn = document.getElementById("clearBtn");
  const fullscreenBtn = null;
  const fullscreenFab = null;
  const fetchMyrientBtn = document.getElementById("fetchMyrientBtn");
  const myrientSelect = document.getElementById("myrientSelect");
  const loadMyrientBtn = document.getElementById("loadMyrientBtn");
  const myrientStatus = document.getElementById("myrientStatus");
  const overlayStatus = document.getElementById("overlayStatus");
  const frame = document.querySelector(".frame");
  let currentObjectUrl = null;

  const LOADER_ID = "ejs-loader-script";
  const ZIP_LIB = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
  const DATA_PATHS = [
    "https://cdn.emulatorjs.org/stable/data/",
    "https://emulatorjs.org/data/",
  ];
  let jszipReady = null;
  let myrientList = [];
  const MYRIENT_DIR =
    "https://myrient.erista.me/files/No-Intro/Nintendo%20-%20Nintendo%20Entertainment%20System%20(Headered)/";

  function setStatus(text) {
    if (statusLine) statusLine.textContent = text || "";
    if (overlayStatus) {
      overlayStatus.textContent = text || "";
      overlayStatus.classList.toggle("visible", !!text);
    }
  }

  function hideInternalFullscreen() {
    const candidates = document.querySelectorAll(
      '#game [data-action="fullscreen"], #game .fullscreen, #game .ejs__fullscreen, #game button[aria-label*="Full"]'
    );
    candidates.forEach((el) => {
      el.style.display = "none";
      el.style.visibility = "hidden";
    });
  }

  function stopEmulator() {
    try {
      if (window.EJS_emulator?.stop) {
        window.EJS_emulator.stop();
      } else if (window.EJS_emulator?.pause) {
        window.EJS_emulator.pause();
      }
    } catch (err) {
      console.warn("Stop emulator failed", err);
    }
    window.EJS_emulator = null;
  }

  function releaseCurrentObjectUrl() {
    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    }
  }

  function resetContainer() {
    stopEmulator();
    if (gameHost) gameHost.innerHTML = "";
    const existing = document.getElementById(LOADER_ID);
    if (existing) existing.remove();
  }

  function injectEmulator(gameUrl, label) {
    if (!gameUrl) {
      setStatus("Chua co ROM de nap.");
      return;
    }

    resetContainer();
    setStatus("Dang nap game...");

    window.EJS_player = "#game";
    window.EJS_core = "nes";
    window.EJS_gameUrl = gameUrl;
    window.EJS_pathtodata = DATA_PATHS[0];
    window.EJS_startOnLoaded = true;
    window.EJS_MenuDisableFullscreen = true; // dùng nút fullscreen riêng bên ngoài, tránh xung đột
    window.EJS_virtualGamepad = true; // auto enable virtual pad on touch devices
    window.EJS_controlScheme = "nes";
    window.EJS_VirtualGamepadSettings = window.EJS_VirtualGamepadSettings || {};
    window.EJS_ready = () => {
      hideInternalFullscreen();
      setTimeout(hideInternalFullscreen, 300);
      setStatus(`Da nap: ${label || "ROM NES"}`);
    };

    const tryPaths = [...DATA_PATHS];
    const loadNext = () => {
      const next = tryPaths.shift();
      if (!next) {
        setStatus(
          "Khong tai duoc loader EmulatorJS (CDN loi). Thu F5 hoac kiem tra mang."
        );
        return;
      }
      window.EJS_pathtodata = next;
      const script = document.createElement("script");
      script.id = LOADER_ID;
      script.src = `${next}loader.js`;
      script.onload = () => setStatus("Dang khoi dong trinh gia lap...");
      script.onerror = () => {
        script.remove();
        loadNext();
      };
      document.body.appendChild(script);
    };
    loadNext();
  }

  function handleLoad() {
    const urlValue = (romUrl?.value || "").trim();
    const file = romFile?.files?.[0];

    // Always stop current game immediately.
    resetContainer();
    setStatus("Dang chuan bi nap ROM...");

    if (file) {
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      if (ext === "zip") {
        setStatus("Dang giai nen ZIP...");
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const buffer = e.target?.result;
            if (!buffer) throw new Error("Khong doc duoc file ZIP.");
            await ensureZipLib();
            const zip = await JSZip.loadAsync(buffer);
            const nesEntry = Object.keys(zip.files).find((name) =>
              name.toLowerCase().endsWith(".nes")
            );
            if (!nesEntry) throw new Error("ZIP khong co file .nes");
            const nesBuffer = await zip.files[nesEntry].async("arraybuffer");
            const blob = new Blob([nesBuffer], {
              type: "application/octet-stream",
            });
            releaseCurrentObjectUrl();
            currentObjectUrl = URL.createObjectURL(blob);
            injectEmulator(currentObjectUrl, nesEntry);
          } catch (err) {
            console.error(err);
            setStatus("Giai nen that bai: " + err.message);
          }
        };
        reader.onerror = () => setStatus("Khong doc duoc file ZIP.");
        reader.readAsArrayBuffer(file);
      } else {
        releaseCurrentObjectUrl();
        currentObjectUrl = URL.createObjectURL(file);
        injectEmulator(currentObjectUrl, file.name);
      }
      return;
    }

    if (urlValue) {
      releaseCurrentObjectUrl();
      injectEmulator(urlValue, urlValue);
      return;
    }

    setStatus("Hay chon file hoac nhap URL ROM.");
  }

  function handleClear() {
    resetContainer();
    releaseCurrentObjectUrl();
    if (romFile) romFile.value = "";
    if (romUrl) romUrl.value = "";
    setStatus("Da xoa cau hinh. Chon ROM moi de nap lai.");
  }

  if (loadBtn) loadBtn.addEventListener("click", handleLoad);
  if (clearBtn) clearBtn.addEventListener("click", handleClear);

  async function fetchTextWithFallback(url) {
    const proxies = [
      "",
      "https://cors.isomorphic-git.org/",
      "https://corsproxy.io/?",
      "https://api.allorigins.win/raw?url=",
      "https://api.codetabs.com/v1/proxy?quest=",
    ];
    let lastErr;
    for (const p of proxies) {
      const target = p ? `${p}${encodeURIComponent(url)}` : url;
      try {
        const res = await fetch(target, { cache: "no-cache" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error("Fetch failed");
  }

  async function ensureZipLib() {
    if (window.JSZip) return;
    if (!jszipReady) {
      jszipReady = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = ZIP_LIB;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Khong tai duoc JSZip."));
        document.body.appendChild(script);
      });
    }
    return jszipReady;
  }

  async function fetchBinaryWithFallback(url) {
    const proxies = [
      "",
      "https://cors.isomorphic-git.org/",
      "https://corsproxy.io/?",
      "https://api.allorigins.win/raw?url=",
      "https://api.codetabs.com/v1/proxy?quest=",
    ];
    let lastErr;
    for (const p of proxies) {
      const target = p ? `${p}${encodeURIComponent(url)}` : url;
      try {
        const res = await fetch(target);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.arrayBuffer();
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error("Fetch failed");
  }

  async function fetchMyrientList() {
    if (fetchMyrientBtn) fetchMyrientBtn.disabled = true;
    if (loadMyrientBtn) loadMyrientBtn.disabled = true;
    if (myrientSelect) {
      myrientSelect.disabled = true;
      myrientSelect.innerHTML = `<option>Dang tai...</option>`;
    }
    if (myrientStatus) myrientStatus.textContent = "Dang tai danh sach tu Myrient...";
    setStatus("Dang tai danh sach tu Myrient...");
    try {
      const html = await fetchTextWithFallback(MYRIENT_DIR);
      const found = [...html.matchAll(/href=\"([^\"]+\.(?:nes|zip))\"/gi)];
      const seen = new Set();
      const rawList = [];

      for (const m of found) {
        const name = m[1];
        if (!name || name.endsWith("/")) continue;
        if (seen.has(name)) continue;
        seen.add(name);
        const decoded = decodeURIComponent(name);
        rawList.push({
          title: decoded.replace(/_/g, " "),
          url: new URL(name, MYRIENT_DIR).href,
        });
      }

      myrientList = rawList.filter(
        (item) => !/^\[?\s*BIOS\]?/i.test(item.title)
      );
      myrientList.sort((a, b) => a.title.localeCompare(b.title));

      if (!myrientList.length)
        throw new Error("Khong tim thay file .nes/.zip hop le");

      if (myrientSelect) {
        myrientSelect.innerHTML = "";
        myrientList.forEach((item, idx) => {
          const opt = document.createElement("option");
          opt.value = String(idx);
          opt.textContent = item.title;
          myrientSelect.appendChild(opt);
        });
        myrientSelect.disabled = false;
      }

      if (loadMyrientBtn) loadMyrientBtn.disabled = false;

      const doneMsg = "Da tai danh sach. Chon game va bam Nap.";
      if (myrientStatus) myrientStatus.textContent = doneMsg;
      setStatus(doneMsg);
    } catch (err) {
      console.error(err);
      const errMsg = "Loi tai danh sach (co the bi CORS). Thu lai.";
      if (myrientStatus) myrientStatus.textContent = errMsg;
      setStatus("Khong tai duoc danh sach Myrient: " + (err?.message || err));
    } finally {
      if (fetchMyrientBtn) fetchMyrientBtn.disabled = false;
    }
  }

  function loadSelectedMyrient() {
    if (!myrientSelect || !myrientList.length) return;
    const idx = Number(myrientSelect.value);
    const item = myrientList[idx];
    if (!item) {
      setStatus("Chua chon game Myrient.");
      return;
    }

    (async () => {
      try {
        resetContainer();
        if (loadMyrientBtn) loadMyrientBtn.disabled = true;
        setStatus("Dang tai ROM tu Myrient...");
        const buffer = await fetchBinaryWithFallback(item.url);
        const ext = (item.url.split(".").pop() || "").toLowerCase();

          if (ext === "zip") {
            await ensureZipLib();
            const zip = await JSZip.loadAsync(buffer);
            const nesEntry = Object.keys(zip.files).find((name) =>
              name.toLowerCase().endsWith(".nes")
            );
            if (!nesEntry) throw new Error("ZIP khong co file .nes");
            const nesBuffer = await zip.files[nesEntry].async("arraybuffer");
            const blob = new Blob([nesBuffer], {
              type: "application/octet-stream",
            });
            releaseCurrentObjectUrl();
            currentObjectUrl = URL.createObjectURL(blob);
            injectEmulator(currentObjectUrl, item.title);
          } else {
            const blob = new Blob([buffer], {
              type: "application/octet-stream",
            });
            releaseCurrentObjectUrl();
            currentObjectUrl = URL.createObjectURL(blob);
            injectEmulator(currentObjectUrl, item.title);
          }
        } catch (err) {
          console.error(err);
        setStatus("Khong tai duoc ROM: " + (err?.message || err));
      } finally {
        if (loadMyrientBtn) loadMyrientBtn.disabled = false;
      }
    })();
  }

  if (fetchMyrientBtn) fetchMyrientBtn.addEventListener("click", fetchMyrientList);
  if (loadMyrientBtn) loadMyrientBtn.addEventListener("click", loadSelectedMyrient);
  if (myrientSelect)
    myrientSelect.addEventListener("change", () => {
      if (loadMyrientBtn && !myrientList.length) return;
      if (loadMyrientBtn) loadMyrientBtn.disabled = false;
    });

  // Fullscreen handled inside EmulatorJS; external buttons removed
})();


