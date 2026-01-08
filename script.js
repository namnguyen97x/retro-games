(() => {
  const body = document.body;
  const CORE = (body?.dataset.core || "nes").toLowerCase();
  const GAME_LABEL = body?.dataset.label || CORE.toUpperCase();
  const MYRIENT_DIR = body?.dataset.myrient || "";
  const NETPLAY_SERVER = body?.dataset.netplayServer || "";
  const NETPLAY_GAME_ID = body?.dataset.netplayGameid || "";
  const NETPLAY_ICE = body?.dataset.netplayIce || "";
  const ZIP_MODE = (body?.dataset.zipMode || "extract").toLowerCase();
  const zipPassthrough = ZIP_MODE === "pass";
  const exts = (body?.dataset.exts || "nes,zip")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const romExts = exts.filter((e) => e !== "zip");
  const primaryExt = romExts[0] || (exts.includes("zip") ? "zip" : "nes");
  const allExtPattern = [...romExts, "zip"].join("|");

  const gameHost = document.getElementById("game");
  const statusLine = document.getElementById("statusLine");
  const romFile = document.getElementById("romFile");
  const romUrl = document.getElementById("romUrl");
  const loadBtn = document.getElementById("loadBtn");
  const clearBtn = document.getElementById("clearBtn");
  const fetchMyrientBtn = document.getElementById("fetchMyrientBtn");
  const myrientSelect = document.getElementById("myrientSelect");
  const loadMyrientBtn = document.getElementById("loadMyrientBtn");
  const myrientStatus = document.getElementById("myrientStatus");
  const myrientField = document.getElementById("myrientField");
  const myrientSearch = document.getElementById("myrientSearch");
  const resumeBtn = document.getElementById("resumeBtn");
  const overlayStatus = document.getElementById("overlayStatus");
  const frame = document.querySelector(".frame");
  let currentObjectUrl = null;

  // Apply theme saved from landing page so players stay in sync.
  (() => {
    const prefersDark =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    const savedTheme = localStorage.getItem("theme");
    const startDark = savedTheme ? savedTheme === "dark" : prefersDark;
    if (body) body.classList.toggle("dark", startDark);
  })();

  const LOADER_ID = "ejs-loader-script";
  const ZIP_LIB = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
  const STORAGE_KEY = "ejs:lastSession";
  const DATA_PATHS = [
    "https://cdn.emulatorjs.org/stable/data/",
    "https://emulatorjs.org/data/",
  ];
  let jszipReady = null;
  let myrientList = [];
  let myrientFiltered = [];

  if (romFile) {
    const acceptList = [];
    if (romExts.length) {
      acceptList.push(romExts.map((e) => `.${e}`).join(","));
    }
    if (exts.includes("zip")) {
      acceptList.push("application/zip,.zip");
    }
    if (acceptList.length) {
      romFile.setAttribute("accept", acceptList.join(","));
    }
  }

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

  function guessGameName(input) {
    if (!input) return "";
    const fromUrl = input.split("/").pop() || input;
    const clean = fromUrl.split("#")[0].split("?")[0];
    const parts = clean.split(".");
    if (parts.length > 1) {
      parts.pop();
    }
    return parts.join(".") || clean;
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

  function injectEmulator(gameUrl, label, parentUrlForCore) {
    if (!gameUrl) {
      setStatus("Chua co ROM de nap.");
      return;
    }

    resetContainer();
    setStatus("Dang nap game...");

    window.EJS_player = "#game";
    window.EJS_core = CORE;
    window.EJS_gameUrl = gameUrl;
    const fileLabel = label || `${GAME_LABEL}.zip`;
    const gameName = guessGameName(fileLabel);
    if (fileLabel) {
      window.EJS_gameUrlName = fileLabel;
    }
    if (gameName) {
      window.EJS_gameName = gameName;
    }
    if (parentUrlForCore) {
      window.EJS_gameParentUrl = parentUrlForCore;
    } else {
      delete window.EJS_gameParentUrl;
    }
    window.EJS_pathtodata = DATA_PATHS[0];
    window.EJS_startOnLoaded = true;
    window.EJS_MenuDisableFullscreen = true;
    window.EJS_virtualGamepad = true;
    window.EJS_controlScheme = CORE;
    // Optional netplay
    if (NETPLAY_SERVER) {
      window.EJS_netplayServer = NETPLAY_SERVER;
      window.EJS_gameID = Number(NETPLAY_GAME_ID) || 1;
      try {
        window.EJS_netplayICEServers = NETPLAY_ICE ? JSON.parse(NETPLAY_ICE) : [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" },
          { urls: "stun:stun.nextcloud.com:3478" },
          { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
          { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
        ];
      } catch (e) {
        console.warn("Invalid NETPLAY_ICE json, using defaults", e);
      }
    }
    const isPsx = CORE === "psx" || CORE === "ps1" || CORE === "psx-fast";
    const padSettings = {
      layout: "extended",
      mode: CORE,
      type: CORE,
      forceVisible: true,
      buttons: CORE === "snes" ? ["l1", "r1"] : [],
    };

    // Custom PSX layout to avoid overlapping buttons on mobile
    const psxCustomPad = [
      // D-pad (scaled down, lifted a bit)
      {
        type: "dpad",
        location: "left",
        left: "8%",
        top: "55%",
        joystickInput: false,
        inputValues: [4, 5, 6, 7],
        size: 0.2,
      },
      // Shoulders
      { type: "button", text: "L1", id: "l1", location: "top", left: 12, top: 28, block: true, input_value: 10 },
      { type: "button", text: "L2", id: "l2", location: "top", left: 12, top: 62, block: true, input_value: 12 },
      { type: "button", text: "R1", id: "r1", location: "top", right: 12, top: 28, block: true, input_value: 11 },
      { type: "button", text: "R2", id: "r2", location: "top", right: 12, top: 62, block: true, input_value: 13 },
      // Face buttons (diamond, slightly tighter)
      { type: "button", text: "Y", id: "y", location: "right", left: 14, top: 56, bold: true, input_value: 9 },
      { type: "button", text: "X", id: "x", location: "right", left: -34, top: 92, bold: true, input_value: 1 },
      { type: "button", text: "B", id: "b", location: "right", left: 62, top: 92, bold: true, input_value: 8 },
      { type: "button", text: "A", id: "a", location: "right", left: 14, top: 128, bold: true, input_value: 0 },
      // Start / Select (centered block)
      { type: "button", text: "Select", id: "select", location: "center", left: -48, top: 96, fontSize: 14, block: true, input_value: 2 },
      { type: "button", text: "Start", id: "start", location: "center", left: 48, top: 96, fontSize: 14, block: true, input_value: 3 },
    ];
    const existingPad = Array.isArray(window.EJS_VirtualGamepadSettings)
      ? window.EJS_VirtualGamepadSettings
      : null;

    // Enable custom mode when we have a tailored pad
    if (isPsx) {
      window.EJS_virtualGamepadMode = "custom";
    }
    if (isPsx) {
      window.EJS_PSX_FORCE_DUALSHOCK = true;
    }
    window.EJS_VirtualGamepadSettings = existingPad
      ? existingPad
      : isPsx
      ? psxCustomPad
      : padSettings;
    window.EJS_ready = () => {
      hideInternalFullscreen();
      setTimeout(hideInternalFullscreen, 300);
      setStatus(`Da nap: ${label || `ROM ${GAME_LABEL}`}`);
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

  function saveLastSession(data) {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          core: CORE,
          label: data?.label || "",
          url: data?.url || "",
          source: data?.source || "url",
        })
      );
    } catch (err) {
      console.warn("Khong luu duoc session", err);
    }
  }

  function readLastSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      console.warn("Khong doc duoc session", err);
      return null;
    }
  }

  function pickZipEntry(zip) {
    const names = Object.keys(zip.files);
    const target = names.find((name) =>
      romExts.length
        ? romExts.some((ext) => name.toLowerCase().endsWith(`.${ext}`))
        : !zip.files[name].dir
    );
    return target;
  }

  async function buildUrlFromZip(buffer, fallbackLabel, extraBuffers = []) {
    const mustMerge = extraBuffers.length > 0;
    if (zipPassthrough && !mustMerge) {
      const blob = new Blob([buffer], { type: "application/zip" });
      releaseCurrentObjectUrl();
      currentObjectUrl = URL.createObjectURL(blob);
      return { url: currentObjectUrl, label: fallbackLabel };
    }

    await ensureZipLib();
    const merged = new JSZip();

    // Additional layers first so the main game can override if needed.
    for (const buf of extraBuffers) {
      if (!buf) continue;
      try {
        const z = await JSZip.loadAsync(buf);
        for (const name of Object.keys(z.files)) {
          const file = z.files[name];
          if (file.dir) continue;
          if (!merged.file(name)) {
            const data = await file.async("arraybuffer");
            merged.file(name, data);
          }
        }
      } catch (err) {
        console.warn("Khong doc duoc zip phu", err);
      }
    }

    const zip = await JSZip.loadAsync(buffer);
    const entry = pickZipEntry(zip);
    if (!entry) throw new Error(`ZIP khong co file .${primaryExt}`);
    for (const name of Object.keys(zip.files)) {
      const file = zip.files[name];
      if (file.dir) continue;
      const data = await file.async("arraybuffer");
      merged.file(name, data);
    }

    const blob = await merged.generateAsync({ type: "blob" });
    releaseCurrentObjectUrl();
    currentObjectUrl = URL.createObjectURL(blob);
    return { url: currentObjectUrl, label: entry };
  }

  function readFileBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const buf = e.target?.result;
        if (!buf) return reject(new Error("Khong doc duoc file"));
        resolve(buf);
      };
      reader.onerror = () => reject(new Error("Khong doc duoc file"));
      reader.readAsArrayBuffer(file);
    });
  }


  function handleLoad() {
    const urlValue = (romUrl?.value || "").trim();
    const file = romFile?.files?.[0];

    resetContainer();
    setStatus("Dang chuan bi nap ROM...");

    if (file) {
      const ext = (file.name.split(".").pop() || "").toLowerCase();

      if (ext === "zip") {
        (async () => {
          try {
            setStatus("Dang chuan bi ROM zip...");
            const buffer = await readFileBuffer(file);
            const parentBuffers = [];

            const { url, label } = await buildUrlFromZip(
              buffer,
              file.name,
              parentBuffers
            );
            injectEmulator(
              url,
              label || file.name,
              ""
            );
          } catch (err) {
            console.error(err);
            setStatus("Giai nen that bai: " + err.message);
          }
        })();
      } else {
        releaseCurrentObjectUrl();
        currentObjectUrl = URL.createObjectURL(file);
        injectEmulator(currentObjectUrl, file.name, "");
      }
      return;
    }

    if (urlValue) {
      const ext = (urlValue.split(".").pop() || "").toLowerCase();
      if (ext === "zip") {
        (async () => {
          try {
            setStatus("Dang tai ZIP tu URL...");
            const buffer = await fetchBinaryWithFallback(urlValue);
            const parentBuffers = [];
            const { url, label } = await buildUrlFromZip(
              buffer,
              urlValue,
              parentBuffers
            );
            injectEmulator(
              url,
              label || urlValue,
              ""
            );
            saveLastSession({
              label: label || urlValue,
              url: urlValue,
              source: "url",
            });
          } catch (err) {
            console.error(err);
            setStatus("Khong tai/gop ZIP: " + err.message);
          }
        })();
      } else {
        releaseCurrentObjectUrl();
        injectEmulator(urlValue, urlValue, "");
        saveLastSession({
          label: urlValue,
          url: urlValue,
          source: "url",
        });
      }
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
        const reader = res.body?.getReader();
        if (!reader) return await res.arrayBuffer();
        const contentLength = Number(res.headers.get("Content-Length")) || 0;
        let received = 0;
        const chunks = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.byteLength;
          if (contentLength) {
            const percent = Math.min(100, Math.round((received / contentLength) * 100));
            setStatus(`Dang tai ROM... ${percent}% (${(received / 1048576).toFixed(2)} MB)`);
          } else {
            setStatus(`Dang tai ROM... ${(received / 1048576).toFixed(2)} MB`);
          }
        }
        const blob = new Blob(chunks, { type: "application/octet-stream" });
        return await blob.arrayBuffer();
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error("Fetch failed");
  }

  async function fetchMyrientList() {
    if (!MYRIENT_DIR) {
      if (myrientStatus) myrientStatus.textContent = "Thu vien nay da tat.";
      return;
    }
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
      const found = [...html.matchAll(new RegExp(`href="([^"]+\\.(?:${allExtPattern}))"`, "gi"))];
      const seen = new Set();
      const rawList = [];

      found.forEach((m) => {
        const name = m[1];
        if (!name || name.endsWith("/")) return;
        if (seen.has(name)) return;
        seen.add(name);
        const decoded = decodeURIComponent(name);
        rawList.push({
          id: rawList.length,
          title: decoded.replace(/_/g, " "),
          url: new URL(name, MYRIENT_DIR).href,
        });
      });

      myrientList = rawList.filter((item) => !/^\[?\s*BIOS\]?/i.test(item.title));
      myrientList.sort((a, b) => a.title.localeCompare(b.title));
      myrientFiltered = [...myrientList];

      if (!myrientList.length) throw new Error(`Khong tim thay file .${primaryExt}/.zip hop le`);

      if (myrientSelect) {
        myrientSelect.innerHTML = "";
        myrientFiltered.forEach((item) => {
          const opt = document.createElement("option");
          opt.value = String(item.id);
          opt.textContent = item.title;
          myrientSelect.appendChild(opt);
        });
        myrientSelect.disabled = false;
      }

      if (myrientSearch) {
        myrientSearch.value = "";
        myrientSearch.disabled = false;
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
    const id = Number(myrientSelect.value);
    const item = myrientList.find((it) => it.id === id) || myrientList[id];
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
        const parentBuffers = [];

        if (ext === "zip") {
          const { url, label } = await buildUrlFromZip(
            buffer,
            item.title,
            parentBuffers
          );
          injectEmulator(
            url,
            label || item.title || item.url,
            ""
          );
          saveLastSession({
            label: label || item.title,
            url: item.url,
            source: "myrient",
          });
        } else {
          const blob = new Blob([buffer], {
            type: "application/octet-stream",
          });
          releaseCurrentObjectUrl();
          currentObjectUrl = URL.createObjectURL(blob);
          injectEmulator(currentObjectUrl, item.title, "");
          saveLastSession({
            label: item.title,
            url: item.url,
            source: "myrient",
          });
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
  if (myrientSearch)
    myrientSearch.addEventListener("input", (e) => {
      const q = (e.target.value || "").toLowerCase();
      myrientFiltered = myrientList.filter((item) =>
        item.title.toLowerCase().includes(q)
      );
      if (myrientSelect) {
        myrientSelect.innerHTML = "";
        myrientFiltered.forEach((item) => {
          const opt = document.createElement("option");
          opt.value = String(item.id);
          opt.textContent = item.title;
          myrientSelect.appendChild(opt);
        });
        myrientSelect.disabled = !myrientFiltered.length;
      }
      if (loadMyrientBtn) loadMyrientBtn.disabled = !myrientFiltered.length;
    });

  if (!MYRIENT_DIR && myrientField) {
    myrientField.style.display = "none";
  }

  const lastSession = (() => {
    const data = readLastSession();
    if (!data || data.core !== CORE || !data.url) return null;
    return data;
  })();

  function loadLastSession(session) {
    if (!session || !session.url) {
      setStatus("Khong co game de mo lai.");
      return;
    }
    if (romFile) romFile.value = "";
    if (romUrl) romUrl.value = session.url;

    if (session.source === "myrient") {
      (async () => {
        try {
          resetContainer();
          if (resumeBtn) resumeBtn.disabled = true;
          setStatus("Dang tai ROM tu danh sach da luu...");
          const buffer = await fetchBinaryWithFallback(session.url);
          const ext = (session.url.split(".").pop() || "").toLowerCase();
          if (ext === "zip") {
            const { url, label } = await buildUrlFromZip(
              buffer,
              session.label || session.url
            );
            injectEmulator(url, label || session.label || session.url);
          } else {
            const blob = new Blob([buffer], {
              type: "application/octet-stream",
            });
            releaseCurrentObjectUrl();
            currentObjectUrl = URL.createObjectURL(blob);
            injectEmulator(currentObjectUrl, session.label || session.url);
          }
        } catch (err) {
          console.error(err);
          setStatus("Khong tai duoc ROM da luu: " + (err?.message || err));
        } finally {
          if (resumeBtn) resumeBtn.disabled = false;
        }
      })();
      return;
    }

    resetContainer();
    setStatus("Dang tai lai ROM...");
    releaseCurrentObjectUrl();
    injectEmulator(session.url, session.label || session.url);
  }

  if (resumeBtn) {
    if (lastSession) {
      resumeBtn.disabled = false;
      resumeBtn.textContent = `Mo lai: ${lastSession.label || "ROM truoc"}`;
      resumeBtn.addEventListener("click", () => loadLastSession(lastSession));
    } else {
      resumeBtn.disabled = true;
    }
  }
})();
