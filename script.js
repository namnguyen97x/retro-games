(() => {
  const screen = document.getElementById("screen");
  if (!screen || !window.jsnes) return;

  const ctx = screen.getContext("2d");
  const statusLine = document.getElementById("statusLine");
  const currentGame = document.getElementById("currentGame");
  const romInput = document.getElementById("romInput");
  const romLoadBtn = document.getElementById("romLoadBtn");
  const remoteListBtn = document.getElementById("remoteListBtn");
  const remoteSearch = document.getElementById("remoteSearch");
  const remoteDatalist = document.getElementById("remoteDatalist");
  const loadingOverlay = document.getElementById("screenLoader");
  const loadingText = document.getElementById("loadingText");
  const fullscreenBtn = document.getElementById("fullscreenBtn");
  const canvasFrame = document.querySelector(".canvas-frame");
  const virtualController = document.querySelector(".virtual-controller");
  const keybindInputs = document.querySelectorAll(".keybind-input");
  const keybindResetButtons = document.querySelectorAll("[data-reset-player]");
  const cheatNameInput = document.getElementById("cheatNameInput");
  const cheatInput = document.getElementById("cheatInput");
  const cheatApplyBtn = document.getElementById("cheatApplyBtn");
  const cheatClearBtn = document.getElementById("cheatClearBtn");
  const cheatStatus = document.getElementById("cheatStatus");
  const toggleButtons = document.querySelectorAll("[data-toggle-target]");
  const joystickZone = document.getElementById("joystickZone");
  let remoteList = [];
  let lastLoadedTitle = "";
  let lastLoadedUrl = "";
  let activeFetchUrl = "";
  let pendingRomFile = null;
  let currentAbortController = null;

  const SCREEN_WIDTH = 256;
  const SCREEN_HEIGHT = 240;
  const NES_BUTTON = jsnes.Controller;
  const FRAME_DURATION = 1000 / 60;

  let nes;
  let animationId;
  let lastFrameTime = 0;
  let frameAccumulator = 0;
  const MAX_REMOTE_LIST = Infinity;
  const STORAGE_KEY_BINDINGS = "nesBindingsV1";
  const STORAGE_KEY_CHEATS = "nesCheatsV1";

  const imageData = ctx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
  const audioBufferSize = 8192;
  let audioCtx;
  let scriptProcessor;
  const audioBufferL = new Float32Array(audioBufferSize);
  const audioBufferR = new Float32Array(audioBufferSize);
  let audioWrite = 0;
  let audioRead = 0;

  const defaultBindings = {
    1: {
      UP: "ArrowUp",
      DOWN: "ArrowDown",
      LEFT: "ArrowLeft",
      RIGHT: "ArrowRight",
      A: "KeyZ",
      B: "KeyX",
      START: "Enter",
      SELECT: "ControlLeft",
    },
    2: {
      UP: "KeyW",
      DOWN: "KeyS",
      LEFT: "KeyA",
      RIGHT: "KeyD",
      A: "KeyJ",
      B: "KeyK",
      START: "Space",
      SELECT: "ShiftLeft",
    },
  };
  const keyState = new Set(); // tracks player-button currently down
  let keyBindings = loadBindings();
  let bindingByKey = new Map(); // keyCode -> [{player, button}]
  let cheats = [];
  let cheatName = "";
  const gamepadState = new Set(); // tracks held buttons from gamepads
  let gamepadPolling = false;
  let joystick;
  const joystickDirs = new Set();

  const BUTTON_LOOKUP = {
    A: NES_BUTTON.BUTTON_A,
    B: NES_BUTTON.BUTTON_B,
    UP: NES_BUTTON.BUTTON_UP,
    DOWN: NES_BUTTON.BUTTON_DOWN,
    LEFT: NES_BUTTON.BUTTON_LEFT,
    RIGHT: NES_BUTTON.BUTTON_RIGHT,
    START: NES_BUTTON.BUTTON_START,
    SELECT: NES_BUTTON.BUTTON_SELECT,
  };

  function cloneBindings(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function loadBindings() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_BINDINGS);
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          1: { ...defaultBindings[1], ...(parsed?.[1] || {}) },
          2: { ...defaultBindings[2], ...(parsed?.[2] || {}) },
        };
      }
    } catch (_) {
      // ignore parse errors and fall back to defaults
    }
    return cloneBindings(defaultBindings);
  }

  function saveBindings() {
    try {
      localStorage.setItem(STORAGE_KEY_BINDINGS, JSON.stringify(keyBindings));
    } catch (_) {
      // best-effort only
    }
  }

  function formatKey(code) {
    if (!code) return "Unbound";
    if (code.startsWith("Key") && code.length === 4) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    switch (code) {
      case "ArrowUp": return "Arrow Up";
      case "ArrowDown": return "Arrow Down";
      case "ArrowLeft": return "Arrow Left";
      case "ArrowRight": return "Arrow Right";
      case "Space": return "Space";
      case "ShiftLeft": return "Left Shift";
      case "ShiftRight": return "Right Shift";
      case "ControlLeft": return "Left Ctrl";
      case "ControlRight": return "Right Ctrl";
      case "AltLeft": return "Left Alt";
      case "AltRight": return "Right Alt";
      case "NumpadEnter": return "Numpad Enter";
      default: return code;
    }
  }

  function rebuildBindingMap() {
    bindingByKey = new Map();
    Object.entries(keyBindings).forEach(([player, mapping]) => {
      Object.entries(mapping).forEach(([button, code]) => {
        if (!code) return;
        if (!bindingByKey.has(code)) bindingByKey.set(code, []);
        bindingByKey.get(code).push({ player: Number(player), button });
      });
    });
  }

  function refreshBindingInputs() {
    keybindInputs.forEach((input) => {
      const player = Number(input.dataset.player);
      const button = input.dataset.button;
      const code = keyBindings[player]?.[button];
      input.value = formatKey(code);
      input.title = code || "";
    });
  }

  function resetBindings(player) {
    keyBindings[player] = cloneBindings(defaultBindings[player]);
    rebuildBindingMap();
    refreshBindingInputs();
    saveBindings();
    setStatus(`Bindings reset for Player ${player}.`);
  }

  function setStatus(message) {
    if (statusLine) statusLine.textContent = message;
  }

  function setLoading(message, isLoading = true) {
    if (!loadingOverlay) return;
    if (loadingText && message) loadingText.textContent = message;
    loadingOverlay.classList.toggle("visible", isLoading);
  }

  function setStatusWithLink(message, url) {
    if (!statusLine) return;
    setLoading("", false);
    statusLine.textContent = "";
    const text = document.createTextNode(message + " ");
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.target = "_blank";
    anchor.rel = "noopener";
    anchor.textContent = "Download and upload manually";
    statusLine.append(text, anchor);
  }

  function parseNumberLike(str) {
    if (!str) return NaN;
    const cleaned = str.trim();
    if (/^0x/i.test(cleaned)) return parseInt(cleaned, 16);
    if (/^[0-9a-f]+$/i && /[a-f]/i.test(cleaned)) return parseInt(cleaned, 16);
    return parseInt(cleaned, 10);
  }

  function getGamepadMapping() {
    // Standard layout works for most PS4/Xbox/360 pads in modern browsers
    return {
      buttons: {
        0: "B", // Cross / A -> NES B
        1: "A", // Circle / B -> NES A
        8: "SELECT",
        9: "START",
        12: "UP",
        13: "DOWN",
        14: "LEFT",
        15: "RIGHT",
      },
      axes: {
        0: { negative: "LEFT", positive: "RIGHT" }, // left stick X
        1: { negative: "UP", positive: "DOWN" }, // left stick Y
      },
    };
  }

  function formatSpeed(bytesPerSec) {
    if (!bytesPerSec || !isFinite(bytesPerSec)) return "";
    if (bytesPerSec >= 1_000_000) return `${(bytesPerSec / 1_000_000).toFixed(2)} MB/s`;
    if (bytesPerSec >= 1_000) return `${(bytesPerSec / 1_000).toFixed(0)} KB/s`;
    return `${bytesPerSec.toFixed(0)} B/s`;
  }

  function parseCheatText(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const parsed = [];
    for (const line of lines) {
      const normalized = line.replace(/[:=]/, " ");
      const [addrRaw, valueRaw] = normalized.split(/\s+/);
      const address = parseNumberLike(addrRaw);
      const value = parseNumberLike(valueRaw);
      if (Number.isNaN(address) || Number.isNaN(value)) {
        throw new Error(`Bad cheat format: "${line}"`);
      }
      if (address < 0 || address > 0xffff) {
        throw new Error(`Address out of range (0-0xFFFF): "${line}"`);
      }
      if (value < 0 || value > 0xff) {
        throw new Error(`Value out of range (0-255): "${line}"`);
      }
      parsed.push({ address: address & 0xffff, value: value & 0xff });
    }
    return parsed;
  }

  function getCpuMemory() {
    if (!nes || !nes.cpu) return null;
    return nes.cpu.mem || nes.cpu.memory || null;
  }

  function updateJoystickButtons(nextDirs) {
    const dirs = ["UP", "DOWN", "LEFT", "RIGHT"];
    dirs.forEach((dir) => {
      const key = `joy-${dir}`;
      const shouldHold = nextDirs.has(dir);
      const isHeld = joystickDirs.has(key);
      if (shouldHold && !isHeld) {
        joystickDirs.add(key);
        pressButton(1, dir, true);
      } else if (!shouldHold && isHeld) {
        joystickDirs.delete(key);
        pressButton(1, dir, false);
      }
    });
  }

  function clearJoystickButtons() {
    const dirs = Array.from(joystickDirs);
    joystickDirs.clear();
    dirs.forEach((key) => {
      const dir = key.replace("joy-", "");
      pressButton(1, dir, false);
    });
  }

  function ensureJoystick() {
    if (!joystickZone || !window.nipplejs) return;
    if (joystick) return;
    joystick = nipplejs.create({
      zone: joystickZone,
      mode: "static",
      position: { left: "50%", top: "50%" },
      color: "#6cffd6",
      size: 160,
      lockX: false,
      lockY: false,
      restOpacity: 0.6,
    });

    joystick.on("move", (_evt, data) => {
      const next = new Set();
      if (data && data.direction) {
        if (data.direction.y === "up") next.add("UP");
        if (data.direction.y === "down") next.add("DOWN");
        if (data.direction.x === "left") next.add("LEFT");
        if (data.direction.x === "right") next.add("RIGHT");
      } else if (data && data.vector) {
        const { x = 0, y = 0 } = data.vector;
        const dead = 0.2;
        if (y < -dead) next.add("UP");
        if (y > dead) next.add("DOWN");
        if (x < -dead) next.add("LEFT");
        if (x > dead) next.add("RIGHT");
      }
      updateJoystickButtons(next);
    });

    joystick.on("end", () => {
      clearJoystickButtons();
    });
  }

  function applyCheats() {
    if (!cheats.length) return;
    const mem = getCpuMemory();
    if (!mem) return;
    for (const cheat of cheats) {
      mem[cheat.address] = cheat.value;
    }
  }

  function updateGamepads() {
    if (!navigator.getGamepads) return;
    const pads = Array.from(navigator.getGamepads()).filter(Boolean);
    const mapping = getGamepadMapping();
    const nextState = new Set();
    const deadzone = 0.25;

    for (let playerIdx = 0; playerIdx < 2; playerIdx++) {
      const pad = pads[playerIdx];
      if (!pad || !pad.connected) continue;
      const player = playerIdx + 1;

      // Buttons
      Object.entries(mapping.buttons).forEach(([buttonIndexStr, nesBtn]) => {
        const buttonIndex = Number(buttonIndexStr);
        const btn = pad.buttons[buttonIndex];
        const pressed = !!(btn && btn.pressed);
        const key = `gp:${player}:${nesBtn}`;
        if (pressed) {
          nextState.add(key);
          if (!gamepadState.has(key)) {
            ensureAudio();
            pressButton(player, nesBtn, true);
          }
        }
      });

      // Axes
      Object.entries(mapping.axes).forEach(([axisIndexStr, axisMap]) => {
        const axisIndex = Number(axisIndexStr);
        const val = pad.axes[axisIndex];
        const keyNeg = `gp:${player}:${axisMap.negative}`;
        const keyPos = `gp:${player}:${axisMap.positive}`;
        if (val <= -deadzone) {
          nextState.add(keyNeg);
          if (!gamepadState.has(keyNeg)) {
            ensureAudio();
            pressButton(player, axisMap.negative, true);
          }
        } else if (val >= deadzone) {
          nextState.add(keyPos);
          if (!gamepadState.has(keyPos)) {
            ensureAudio();
            pressButton(player, axisMap.positive, true);
          }
        }
      });
    }

    // Release buttons no longer active
    gamepadState.forEach((key) => {
      if (nextState.has(key)) return;
      const parts = key.split(":");
      if (parts.length === 3) {
        const player = Number(parts[1]);
        const btn = parts[2];
        pressButton(player, btn, false);
      }
    });

    gamepadState.clear();
    nextState.forEach((k) => gamepadState.add(k));
  }

  function startGamepadPolling() {
    if (gamepadPolling || !navigator.getGamepads) return;
    gamepadPolling = true;
    const loop = () => {
      if (!gamepadPolling) return;
      updateGamepads();
      requestAnimationFrame(loop);
    };
    loop();
  }

  function stopGamepadPolling() {
    gamepadPolling = false;
    // Release any held buttons
    gamepadState.forEach((key) => {
      const parts = key.split(":");
      if (parts.length === 3) {
        const player = Number(parts[1]);
        const btn = parts[2];
        pressButton(player, btn, false);
      }
    });
    gamepadState.clear();
  }

  function updateCheatStatus() {
    if (!cheatStatus) return;
    if (!cheats.length) {
      cheatStatus.textContent = "No cheats active.";
      return;
    }
    const namePart = cheatName ? ` (${cheatName})` : "";
    cheatStatus.textContent = `${cheats.length} cheat${cheats.length > 1 ? "s" : ""} active${namePart}.`;
  }

  function loadCheatsFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_CHEATS);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          cheats = parsed;
          cheatName = "";
        } else if (parsed && typeof parsed === "object") {
          cheats = Array.isArray(parsed.cheats) ? parsed.cheats : [];
          cheatName = parsed.name || "";
        }
        updateCheatStatus();
        if (cheatNameInput) cheatNameInput.value = cheatName || "";
        if (cheatInput) cheatInput.value = cheats.map((c) => `0x${c.address.toString(16)}=${c.value.toString(16).padStart(2, "0")}`).join("\n");
      }
    } catch (_) {
      // ignore
    }
  }

  function saveCheatsToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY_CHEATS, JSON.stringify({ name: cheatName, cheats }));
    } catch (_) {
      // ignore
    }
  }

  function ensureAudio() {
    if (audioCtx) {
      if (audioCtx.state === "suspended") audioCtx.resume();
      return;
    }

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    scriptProcessor = audioCtx.createScriptProcessor(1024, 0, 2);
    scriptProcessor.onaudioprocess = (event) => {
      const outL = event.outputBuffer.getChannelData(0);
      const outR = event.outputBuffer.getChannelData(1);
      for (let i = 0; i < outL.length; i++) {
        if (audioRead !== audioWrite) {
          outL[i] = audioBufferL[audioRead];
          outR[i] = audioBufferR[audioRead];
          audioRead = (audioRead + 1) % audioBufferSize;
        } else {
          outL[i] = 0;
          outR[i] = 0;
        }
      }
    };
    scriptProcessor.connect(audioCtx.destination);
  }

  function pushAudioSample(left, right) {
    audioBufferL[audioWrite] = left;
    audioBufferR[audioWrite] = right;
    audioWrite = (audioWrite + 1) % audioBufferSize;
    if (audioWrite === audioRead) {
      audioRead = (audioRead + 1) % audioBufferSize; // drop oldest sample to avoid overflow
    }
  }

  function createNES() {
    audioRead = audioWrite = 0;
    nes = new jsnes.NES({
      onFrame: (frameBuffer) => {
        for (let i = 0; i < frameBuffer.length; i++) {
          const color = frameBuffer[i];
          imageData.data[i * 4 + 0] = color & 0xff;
          imageData.data[i * 4 + 1] = (color >> 8) & 0xff;
          imageData.data[i * 4 + 2] = (color >> 16) & 0xff;
          imageData.data[i * 4 + 3] = 0xff;
        }
        ctx.putImageData(imageData, 0, 0);
      },
      onAudioSample: (left, right) => {
        pushAudioSample(left, right);
      },
      onStatusUpdate: (msg) => setStatus(msg),
    });
  }

  function startLoop() {
    stopLoop();
    lastFrameTime = 0;
    frameAccumulator = 0;
    const step = (ts) => {
      if (!lastFrameTime) lastFrameTime = ts;
      let delta = ts - lastFrameTime;
      // If tab was hidden, delta can be huge; cap to avoid catch-up lag
      if (delta > 120) {
        delta = FRAME_DURATION;
        frameAccumulator = FRAME_DURATION;
      } else {
        frameAccumulator += delta;
      }
      try {
        while (frameAccumulator >= FRAME_DURATION) {
          applyCheats();
          nes.frame();
          frameAccumulator -= FRAME_DURATION;
        }
      } catch (err) {
        console.error(err);
        setStatus("Emulator error: " + err.message);
        stopLoop();
        return;
      }
      lastFrameTime = ts;
      animationId = requestAnimationFrame(step);
    };
    animationId = requestAnimationFrame(step);
  }

  function isZipBuffer(buffer) {
    const bytes = new Uint8Array(buffer);
    return bytes[0] === 0x50 && bytes[1] === 0x4b;
  }

  function isNesBuffer(buffer) {
    const bytes = new Uint8Array(buffer);
    return bytes[0] === 0x4e && bytes[1] === 0x45 && bytes[2] === 0x53 && bytes[3] === 0x1a;
  }

  async function extractNesFromZip(buffer) {
    if (typeof JSZip === "undefined") throw new Error("JSZip not loaded");
    const zip = await JSZip.loadAsync(buffer);
    const entries = Object.keys(zip.files);
    const nesEntry = entries.find((name) => name.toLowerCase().endsWith(".nes"));
    if (!nesEntry) throw new Error("No .nes file inside zip");
    return zip.files[nesEntry].async("arraybuffer");
  }

  async function handleRomBuffer(buffer, label) {
    const isZip = isZipBuffer(buffer);
    if (isZip) {
      setLoading("Extracting ZIP...");
      const nesBuffer = await extractNesFromZip(buffer);
      loadRom(nesBuffer, (label || "ROM") + " (unzipped)");
    } else {
      if (!isNesBuffer(buffer)) {
        throw new Error("Response is not a NES ROM (likely CORS/HTML or wrong file).");
      }
      loadRom(buffer, label);
    }
  }

  function stopLoop() {
    if (animationId) cancelAnimationFrame(animationId);
    animationId = null;
  }

  function arrayBufferToBinaryString(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      const sub = bytes.subarray(i, i + chunk);
      binary += String.fromCharCode.apply(null, sub);
    }
    return binary;
  }

  function loadRom(buffer, label = "Custom ROM") {
    try {
      ensureAudio();
      createNES();
      keyState.clear();
      const romData = arrayBufferToBinaryString(buffer);
      nes.loadROM(romData);
      startLoop();
      if (currentGame) currentGame.textContent = label;
      setStatus("Loaded: " + label);
      lastLoadedTitle = label;
      setLoading("", false);
    } catch (error) {
      console.error(error);
      setStatus("Failed to load ROM: " + error.message);
      setLoading("", false);
    }
  }

  function pressButton(playerIndex, buttonName, isDown) {
    const nesButton = BUTTON_LOOKUP[buttonName];
    if (nesButton === undefined) return;
    const port = playerIndex === 2 ? 2 : 1;
    if (isDown) nes.buttonDown(port, nesButton);
    else nes.buttonUp(port, nesButton);
  }

  function handleKeyDown(event) {
    // Xử lý phím ESC để thoát fullscreen
    if (event.code === "Escape" && document.fullscreenElement) {
      event.preventDefault();
      document.exitFullscreen().catch(() => {});
      return;
    }
    
    const active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
      if (!active.classList.contains("keybind-input")) return;
    }
    const mappings = bindingByKey.get(event.code);
    if (!mappings || !mappings.length) return;
    event.preventDefault();
    ensureAudio();
    mappings.forEach(({ player, button }) => {
      const key = `${player}-${button}`;
      if (keyState.has(key)) return;
      keyState.add(key);
      pressButton(player, button, true);
    });
  }

  function handleKeyUp(event) {
    const active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
      if (!active.classList.contains("keybind-input")) return;
    }
    const mappings = bindingByKey.get(event.code);
    if (!mappings || !mappings.length) return;
    event.preventDefault();
    mappings.forEach(({ player, button }) => {
      const key = `${player}-${button}`;
      keyState.delete(key);
      pressButton(player, button, false);
    });
  }

  function wireTouchControls() {
    const buttons = document.querySelectorAll(".touch-button[data-button]");
    buttons.forEach((btn) => {
      const buttonName = btn.dataset.button;
      const directions = btn.dataset.directions ? JSON.parse(btn.dataset.directions) : null;
      
      const start = (event) => {
        event.preventDefault();
        ensureAudio();
        btn.classList.add("pressed");
        
        // Nếu là nút chéo, nhấn cả 2 hướng
        if (directions && directions.length === 2) {
          directions.forEach((dir) => {
            pressButton(1, dir, true);
          });
        } else {
          pressButton(1, buttonName, true);
        }
      };
      
      const end = (event) => {
        event.preventDefault();
        btn.classList.remove("pressed");
        
        // Nếu là nút chéo, thả cả 2 hướng
        if (directions && directions.length === 2) {
          directions.forEach((dir) => {
            pressButton(1, dir, false);
          });
        } else {
          pressButton(1, buttonName, false);
        }
      };
      
      btn.addEventListener("touchstart", start, { passive: false });
      btn.addEventListener("touchend", end, { passive: false });
      btn.addEventListener("touchcancel", end, { passive: false });
    });
  }

  function wireToggleSections() {
    toggleButtons.forEach((btn) => {
      const targetId = btn.dataset.toggleTarget;
      const section = document.getElementById(`section-${targetId}`);
      if (!section) return;
      const toggle = () => {
        const active = !section.classList.contains("active");
        section.classList.toggle("active", active);
        btn.classList.toggle("active", active);
      };
      btn.addEventListener("click", toggle);
    });
  }

  function bindKeyInput(input) {
    input.addEventListener("focus", () => {
      input.classList.add("listening");
      input.value = "Press any key...";
    });

    input.addEventListener("blur", () => {
      input.classList.remove("listening");
      const player = Number(input.dataset.player);
      const button = input.dataset.button;
      input.value = formatKey(keyBindings[player]?.[button]);
    });

    input.addEventListener("keydown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const player = Number(input.dataset.player);
      const button = input.dataset.button;
      const code = event.code;
      keyBindings[player][button] = code;
      rebuildBindingMap();
      saveBindings();
      input.value = formatKey(code);
      input.blur();
      setStatus(`Mapped ${button} for P${player} to ${formatKey(code)}.`);
    });
  }

  function wireBindingInputs() {
    keybindInputs.forEach((input) => bindKeyInput(input));
    keybindResetButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const player = Number(btn.dataset.resetPlayer);
        resetBindings(player);
      });
    });
    refreshBindingInputs();
  }

  function initInputs() {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("gamepadconnected", (e) => {
      setStatus(`Gamepad connected: ${e.gamepad.id}`);
      startGamepadPolling();
    });
    window.addEventListener("gamepaddisconnected", (e) => {
      setStatus(`Gamepad disconnected: ${e.gamepad.id}`);
      if (!navigator.getGamepads || !Array.from(navigator.getGamepads()).some((p) => p && p.connected)) {
        stopGamepadPolling();
      }
    });
    startGamepadPolling();
    document.addEventListener("visibilitychange", () => {
      // Reset timers when switching tabs to prevent frame backlog stutter
      if (document.hidden) {
        lastFrameTime = 0;
        frameAccumulator = 0;
      }
    });

    if (fullscreenBtn && canvasFrame) {
      fullscreenBtn.addEventListener("click", async () => {
        try {
          if (!document.fullscreenElement) {
            await canvasFrame.requestFullscreen();
          } else {
            await document.exitFullscreen();
          }
        } catch (err) {
          console.error(err);
          setStatus("Fullscreen failed: " + err.message);
        }
      });

      // Delegate fullscreen updates to the centralized updateMobileControls handler.
      // This handler simply triggers an update when fullscreen state changes.
      document.addEventListener("fullscreenchange", () => {
        updateMobileControls();
      });
    }

    if (romInput) {
      romInput.addEventListener("change", (event) => {
        const file = event.target.files && event.target.files[0];
        pendingRomFile = file || null;
        if (!file) return;
        lastLoadedUrl = "";
        activeFetchUrl = "";
        setLoading("", false);
        setStatus(`Ready to load: ${file.name}. Click "Load ROM" to confirm.`);
      });
    }

    if (romLoadBtn) {
      romLoadBtn.addEventListener("click", () => {
        const file = pendingRomFile;
        if (!file) {
          setStatus("No file selected.");
          return;
        }
        setStatus("Loading " + file.name + "...");
        setLoading("Loading file...");
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const buffer = e.target.result;
            await handleRomBuffer(buffer, file.name);
          } catch (err) {
            console.error(err);
            setStatus("Failed to load file: " + err.message);
            setLoading("", false);
          }
        };
        reader.onerror = () => {
          setStatus("Failed to read file.");
          setLoading("", false);
        };
        reader.readAsArrayBuffer(file);
      });
    }

    wireTouchControls();
    wireToggleSections();
    const fetchArrayBufferWithFallback = async (url, onProgress, signal) => {
      const proxies = [
        "", // direct
        "https://cors.isomorphic-git.org/",
        "https://corsproxy.io/?",
        "https://api.allorigins.win/raw?url=",
        "https://api.codetabs.com/v1/proxy?quest=",
      ];
      let lastError = null;
      for (const prefix of proxies) {
        // Kiểm tra nếu đã bị hủy
        if (signal && signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        
        const target = prefix ? `${prefix}${encodeURIComponent(url)}` : url;
        try {
          const res = await fetch(target, { cache: "no-cache", signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          // Stream to track speed
          if (!res.body || !res.body.getReader) {
            const buf = await res.arrayBuffer();
            if (onProgress && !(signal && signal.aborted)) {
              onProgress({ received: buf.byteLength, total: buf.byteLength, elapsed: 0.001 });
            }
            return buf;
          }
          const total = Number(res.headers.get("Content-Length")) || 0;
          const reader = res.body.getReader();
          const chunks = [];
          let received = 0;
          const start = performance.now();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            // Kiểm tra nếu đã bị hủy
            if (signal && signal.aborted) {
              reader.cancel();
              throw new DOMException('Aborted', 'AbortError');
            }
            
            chunks.push(value);
            received += value.length;
            if (onProgress && !(signal && signal.aborted)) {
              const elapsed = Math.max((performance.now() - start) / 1000, 0.001);
              onProgress({ received, total, elapsed });
            }
          }
          const buffer = new Uint8Array(received);
          let offset = 0;
          for (const c of chunks) {
            buffer.set(c, offset);
            offset += c.length;
          }
          if (onProgress && !(signal && signal.aborted)) {
            const elapsed = Math.max((performance.now() - start) / 1000, 0.001);
            onProgress({ received, total: total || received, elapsed });
          }
          return buffer.buffer;
        } catch (err) {
          // Nếu bị hủy, throw ngay lập tức
          if (err.name === 'AbortError') {
            throw err;
          }
          lastError = err;
          // Try next proxy
        }
      }
      throw lastError || new Error("Fetch failed");
    };

    const fetchAndLoad = async (url, label) => {
      if (!url) return;
      // Cho phép hủy quá trình load hiện tại và bắt đầu load game mới
      if (url === lastLoadedUrl) {
        // Chỉ chặn nếu game đã được load (không phải đang load)
        setLoading("", false);
        return;
      }
      
      // Hủy quá trình fetch đang chạy nếu có
      if (currentAbortController) {
        currentAbortController.abort();
        currentAbortController = null;
      }
      
      setStatus(`Fetching ROM: ${label || url}`);
      setLoading("Preparing download...");
      activeFetchUrl = url;
      
      // Tạo AbortController mới cho request này
      currentAbortController = new AbortController();
      const signal = currentAbortController.signal;
      
      try {
        ensureAudio();
        const buffer = await fetchArrayBufferWithFallback(url, ({ received, total, elapsed }) => {
          // Kiểm tra nếu đã bị hủy
          if (signal.aborted) return;
          const speed = formatSpeed(received / Math.max(elapsed, 0.001));
          const pct = total ? ` (${((received / total) * 100).toFixed(1)}%)` : "";
          const size = received >= 1_000_000 ? `${(received / 1_000_000).toFixed(2)} MB` : `${(received / 1_000).toFixed(0)} KB`;
          setLoading(`Downloading... ${size}${pct} @ ${speed}`);
          setStatus(`Downloading: ${size}${pct} @ ${speed}`);
        }, signal);
        
        // Kiểm tra lại nếu đã bị hủy
        if (signal.aborted) return;
        
        await handleRomBuffer(buffer, label || (url.split("/").pop() || "Remote ROM"));
        lastLoadedUrl = url;
      } catch (error) {
        // Bỏ qua lỗi nếu đã bị hủy
        if (error.name === 'AbortError') {
          setStatus("Load cancelled. Starting new game...");
          return;
        }
        console.error(error);
        setStatusWithLink(error.message || "Failed to fetch ROM (likely CORS).", url);
        setLoading("", false);
      } finally {
        if (activeFetchUrl === url) {
          activeFetchUrl = "";
        }
        currentAbortController = null;
      }
    };

    const fetchTextWithFallback = async (url) => {
      const proxies = [
        "",
        "https://cors.isomorphic-git.org/",
        "https://corsproxy.io/?",
        "https://api.allorigins.win/raw?url=",
        "https://api.codetabs.com/v1/proxy?quest=",
      ];
      let lastError = null;
      for (const prefix of proxies) {
        const target = prefix ? `${prefix}${encodeURIComponent(url)}` : url;
        try {
          const res = await fetch(target, { cache: "no-cache" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return await res.text();
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError || new Error("Fetch failed");
    };

    const applySearchFilter = () => {
      const term = (remoteSearch && remoteSearch.value || "").trim().toLowerCase();
      const filtered = term
        ? remoteList.filter((item) => item.title.toLowerCase().includes(term))
        : remoteList;
      if (remoteDatalist) {
        remoteDatalist.innerHTML = "";
        filtered.slice(0, 200).forEach((item) => {
          const o = document.createElement("option");
          o.value = item.title;
          remoteDatalist.appendChild(o);
        });
      }
      setStatus(
        remoteList.length
          ? `Showing ${filtered.length} of ${remoteList.length} entries.`
          : "Fetch list to populate games."
      );
      return filtered;
    };

    const loadFirstMatch = async () => {
      const filtered = applySearchFilter();
      if (!filtered.length) return;
      const match = filtered[0];
      // Cho phép load game mới ngay cả khi đang load game khác
      if (match.url === lastLoadedUrl) return;
      await fetchAndLoad(match.url, match.title);
    };

    if (remoteListBtn) {
      remoteListBtn.addEventListener("click", async () => {
        const dirUrl = "https://myrient.erista.me/files/No-Intro/Nintendo%20-%20Nintendo%20Entertainment%20System%20(Headered)/";
        setStatus("Fetching directory listing...");
        remoteListBtn.disabled = true;
        setLoading("Fetching directory...");
        try {
          const html = await fetchTextWithFallback(dirUrl);
          const found = [...html.matchAll(/href=\"([^\"]+\.(?:nes|zip))\"/gi)];
          const seen = new Set();
          remoteList = [];
          for (const match of found) {
            let name = match[1];
            if (!name) continue;
            name = decodeURIComponent(name);
            if (name.endsWith("/")) continue;
            if (seen.has(name)) continue;
            seen.add(name);
            remoteList.push({
              title: name.replace(/_/g, " "),
              url: dirUrl + encodeURIComponent(name),
            });
            if (remoteList.length >= MAX_REMOTE_LIST) break;
          }
          remoteList.sort((a, b) => a.title.localeCompare(b.title));
          if (!remoteList.length) throw new Error("No .nes or .zip files found");
          applySearchFilter();
          setStatus(`Loaded ${remoteList.length} entries from MyRient. Filter and load.`);
          setLoading("", false);
        } catch (error) {
          console.error(error);
          setStatusWithLink("Failed to fetch directory (likely CORS).", dirUrl);
          setLoading("", false);
        } finally {
          remoteListBtn.disabled = false;
        }
      });
    }

    if (remoteSearch) {
      remoteSearch.addEventListener("input", () => {
        const filtered = applySearchFilter();
        const term = remoteSearch.value.trim().toLowerCase();
        const exact = filtered.find((item) => item.title.toLowerCase() === term);
        // Cho phép load game mới ngay cả khi đang load game khác
        if (exact && exact.url !== lastLoadedUrl) {
          fetchAndLoad(exact.url, exact.title);
        }
      });
      remoteSearch.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          loadFirstMatch();
        }
      });
      remoteSearch.addEventListener("change", () => {
        loadFirstMatch();
      });
      // Ensure soft keyboard opens on touch
      remoteSearch.addEventListener("touchend", () => {
        remoteSearch.focus({ preventScroll: false });
      });
    }

    wireBindingInputs();
    loadCheatsFromStorage();

    if (cheatApplyBtn) {
      cheatApplyBtn.addEventListener("click", () => {
        if (!cheatInput) return;
        try {
          cheatName = (cheatNameInput && cheatNameInput.value.trim()) || "";
          cheats = parseCheatText(cheatInput.value);
          updateCheatStatus();
          saveCheatsToStorage();
          setStatus(cheats.length ? `Applied ${cheats.length} cheat${cheats.length > 1 ? "s" : ""}.` : "Cheats cleared.");
        } catch (err) {
          console.error(err);
          setStatus(err.message);
        }
      });
    }

    if (cheatClearBtn) {
      cheatClearBtn.addEventListener("click", () => {
        cheats = [];
        cheatName = "";
        if (cheatInput) cheatInput.value = "";
        if (cheatNameInput) cheatNameInput.value = "";
        updateCheatStatus();
        saveCheatsToStorage();
        setStatus("Cheats cleared.");
      });
    }
  }

  function bootstrap() {
    createNES();
    rebuildBindingMap();
    refreshBindingInputs();
    setStatus("Ready. Upload a .nes file to begin.");
    setLoading("", false);
    initInputs();
  }

  bootstrap();

  // Mobile UI detection and controls visibility
  // Show virtual controller when running on a touch device or small viewport,
  // regardless of fullscreen state. This ensures that mobile users (and
  // developers simulating mobile devices in DevTools) see the on-screen controls.
  function shouldUseMobileUI() {
    return (
      'ontouchstart' in window ||
      (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
      window.matchMedia('(pointer: coarse)').matches ||
      window.innerWidth <= 900
    );
  }

  function updateMobileControls() {
    const active = document.fullscreenElement === canvasFrame;
    const mobileUI = shouldUseMobileUI();
    // Show controls only when fullscreen is active AND we detect a mobile/touch viewport. This prevents
    // the virtual controller from appearing in windowed mode on small screens.
    const show = active && mobileUI;
    canvasFrame.classList.toggle('fullscreen-active', active);
    document.body.classList.toggle('fullscreen-mobile', show);
    document.body.classList.toggle('fullscreen-hud', show);
    if (virtualController) {
      virtualController.classList.toggle('visible', show);
    }
    if (show) {
      ensureJoystick();
    } else {
      clearJoystickButtons();
    }
  }

  // Update controls on resize/orientation change and after fullscreen toggle
  window.addEventListener('resize', updateMobileControls);
  window.addEventListener('orientationchange', updateMobileControls);
  document.addEventListener('fullscreenchange', () => {
    updateMobileControls();
    if (document.fullscreenElement === canvasFrame && shouldUseMobileUI() && screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(() => {});
    }
  });

  // Initial call to set correct state on load
  updateMobileControls();
})();
