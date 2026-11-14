(() => {
  /*
   * CONFIGURAZIONE GENERALE
   */

  const CONFIG = {
    physics: {
      gravity: 550, // Accelerazione verso il basso (px/s²)
      liftAcceleration: 1400, // Spinta massima verso l'alto (px/s²)
      maxFallSpeed: 650, // Velocità massima di caduta (px/s)
      maxRiseSpeed: 400, // Velocità massima di salita (px/s)
    },
    force: {
      maxKg: 30, // Kg necessari per ottenere il 100% della spinta
      deadZoneKg: 0.3, // Piccole letture ignorate (kg)
      responseExponent: 0.8, // 1 = lineare; >1 = serve più forza all'inizio
      smoothing: 0.7, // Filtraggio: 0 = lento? No: 0.1 stabile, 0.6 rapido
    },
    gameplay: {
      pipeSpeed: 300, // Velocità tubi (px/s)
      pipeWidth: 76, // Larghezza tubi (px)
      pipeGap: 250, // Spazio libero tra i tubi (px)
      pipeMinTop: 80, // Altezza minima del tubo superiore (px)
      pipeMaxTop: 400, // Altezza massima del tubo superiore (px)
      pipeInterval: 2.0, // Secondi tra un ostacolo e il successivo
      groundHeight: 45, // Altezza del terreno dal bordo inferiore (px)
      pipeCapOverhang: 7, // Quanto sporge il bordo del tubo
      pipeCapHeight: 22, // Altezza del bordo del tubo
    },
    bird: {
      x: 180,
      startY: 200,
      radius: 17, // Raggio usato per le collisioni
      bodyWidth: 19,
      bodyHeight: 15,
    },
    graphics: {
      skyTop: "#7dd3fc",
      skyBottom: "#e0f2fe",
      birdColor: "#ffd43b",
      birdOutline: "#8c5c12",
      pipeColor: "#22a447",
      pipeOutline: "#12632d",
      pipeHighlight: "#36c45b",
      groundColor: "#c69c57",
      grassColor: "#64b84f",
    },
    messagges: {
      buttonStart: "▶ Inizia",
      buttonWaiting: "⏳ Pronti…",
      buttonRetry: "↻ Riprova",
      buttonDisabledTitle: "Collega prima il Tindeq Progressor per iniziare.",
      playSubtitle: "Metti alla prova la tua forza",
    },
    ble: {
      // UUID BLE Progressor: servizio, Data Point, Control Point
      service: "7e4e1701-1ea6-40c9-9dcc-13d34ffead57",
      dataPoint: "7e4e1702-1ea6-40c9-9dcc-13d34ffead57",
      controlPoint: "7e4e1703-1ea6-40c9-9dcc-13d34ffead57",
      stopOpcode: 0x66,
      startOpcode: 0x65,
      commandDelayMs: 180,
    },
  };

  const $ = (id) => document.getElementById(id);

  const canvas = $("game");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const ground = H - CONFIG.gameplay.groundHeight;

  let device = null;
  let server = null;
  let dataChar = null;
  let controlChar = null;
  let rawForce = 0;
  let filteredForce = 0;
  let baseline = 0;
  let bird;
  let pipes = [];
  let score = 0;
  let best = Number(localStorage.getItem("gripbird-best") || 0);
  let running = false;
  let gameOver = false;
  let lastTime = 0;
  let spawn = 0;

  $("best").textContent = best;

  function setStatus(message) {
    $("status").textContent = message;
  }

  function setState(message) {
    $("state").textContent = message;
  }

  function isTindeqConnected() {
    return Boolean(device?.gatt?.connected && controlChar);
  }

  function updateStartButtonState() {
    const startButton = $("start");
    const connected = isTindeqConnected();
    const waiting = startButton.textContent === CONFIG.messagges.buttonWaiting;

    startButton.disabled = !connected || waiting;
    startButton.title = connected ? "" : CONFIG.messagges.buttonDisabledTitle;
    startButton.setAttribute(
      "aria-label",
      connected ? "Inizia o riprova" : CONFIG.messagges.buttonDisabledTitle,
    );
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Converte la forza in una percentuale di spinta compresa tra 0 e 1
  function getLiftRatio(forceKg) {
    const { maxKg, deadZoneKg, responseExponent } = CONFIG.force;
    const effectiveForce = Math.max(0, forceKg - deadZoneKg);
    const availableForce = Math.max(0.001, maxKg - deadZoneKg);
    const ratio = Math.max(0, Math.min(1, effectiveForce / availableForce));

    return Math.pow(ratio, Math.max(0.2, responseExponent));
  }

  function updateForceUI() {
    const forceForGame = Math.max(0, filteredForce - baseline);
    const ratio = getLiftRatio(forceForGame);

    $("force").textContent = `${rawForce.toFixed(2)} kg`;
    $("lift").textContent = `${Math.round(ratio * 100)}%`;
    $("forceBar").style.width = `${ratio * 100}%`;
  }

  /*
   * LOGICA DI GIOCO
   */

  function reset() {
    bird = {
      x: CONFIG.bird.x,
      y: CONFIG.bird.startY,
      vy: 0,
      r: CONFIG.bird.radius,
    };

    pipes = [];
    score = 0;
    spawn = 0;
    gameOver = false;
    $("start").textContent = CONFIG.messagges.buttonStart;
    $("start").hidden = false;
    $("score").textContent = "0";
    updateStartButtonState();
    setState("In gioco");
  }

  function endGame() {
    running = false;
    gameOver = true;
    $("start").textContent = CONFIG.messagges.buttonRetry;
    $("start").hidden = false;
    updateStartButtonState();
    setState("Game over");
  }

  function addPipe() {
    const g = CONFIG.gameplay;
    const top = g.pipeMinTop + Math.random() * (g.pipeMaxTop - g.pipeMinTop);

    pipes.push({
      x: W + 20,
      top,
      gap: g.pipeGap,
      passed: false,
    });
  }

  function drawBird() {
    const g = CONFIG.graphics;
    const b = CONFIG.bird;
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(Math.max(-0.45, Math.min(0.8, bird.vy * 0.045)));
    ctx.fillStyle = g.birdColor;
    ctx.strokeStyle = g.birdOutline;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, 0, b.bodyWidth, b.bodyHeight, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(8, -6, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#172033";
    ctx.beginPath();
    ctx.arc(10, -6, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f97316";
    ctx.beginPath();
    ctx.moveTo(16, 1);
    ctx.lineTo(30, 6);
    ctx.lineTo(16, 10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#f59e0b";
    ctx.beginPath();
    ctx.ellipse(-8, 8, 10, 5, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function draw() {
    const g = CONFIG.graphics;
    const game = CONFIG.gameplay;
    const sky = ctx.createLinearGradient(0, 0, 0, H);

    sky.addColorStop(0, g.skyTop);
    sky.addColorStop(1, g.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Nuvole decorative
    ctx.fillStyle = "rgba(255,255,255,.75)";

    for (let i = 0; i < 4; i++) {
      const x =
        ((((i * 235 - Date.now() * 0.012) % (W + 100)) + W + 100) % (W + 100)) -
        40;

      ctx.beginPath();
      ctx.arc(x, 105 + (i % 2) * 75, 22, 0, 7);
      ctx.arc(x + 25, 98 + (i % 2) * 75, 28, 0, 7);
      ctx.arc(x + 52, 108 + (i % 2) * 75, 19, 0, 7);
      ctx.fill();
    }

    pipes.forEach((p) => {
      const w = game.pipeWidth;
      const capX = p.x - game.pipeCapOverhang;
      const capW = w + game.pipeCapOverhang * 2;
      const capH = game.pipeCapHeight;

      ctx.fillStyle = g.pipeColor;
      ctx.strokeStyle = g.pipeOutline;
      ctx.lineWidth = 5;
      ctx.fillRect(p.x, 0, w, p.top);
      ctx.strokeRect(p.x, 0, w, p.top);
      ctx.fillRect(p.x, p.top + p.gap, w, ground - (p.top + p.gap));
      ctx.strokeRect(p.x, p.top + p.gap, w, ground - (p.top + p.gap));
      ctx.fillStyle = g.pipeHighlight;
      ctx.fillRect(capX, p.top - capH, capW, capH);
      ctx.fillRect(capX, p.top + p.gap, capW, capH);
    });

    ctx.fillStyle = g.groundColor;
    ctx.fillRect(0, ground, W, H - ground);
    ctx.fillStyle = g.grassColor;
    ctx.fillRect(0, ground, W, 13);

    if (bird) drawBird();

    if (!running) {
      ctx.fillStyle = "rgba(12,24,42,.62)";
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = "center";
      ctx.fillStyle = "white";
      ctx.font = "bold 42px system-ui";
      ctx.fillText(gameOver ? "GAME OVER" : "GRIP BIRD", W / 2, H / 2 - 18);
      ctx.font = "22px system-ui";
      ctx.fillText(
        gameOver ? `Punteggio: ${score}` : CONFIG.messagges.playSubtitle,
        W / 2,
        H / 2 + 25,
      );
    }
  }

  function loop(timestamp) {
    const dt = Math.min(0.035, (timestamp - lastTime) / 1000 || 0.016);
    lastTime = timestamp;

    if (running) {
      const physics = CONFIG.physics;
      const game = CONFIG.gameplay;
      const forceForGame = Math.max(0, filteredForce - baseline);
      const liftRatio = getLiftRatio(forceForGame);
      const lift = physics.liftAcceleration * liftRatio;

      // Accelerazione risultante: gravità verso il basso meno spinta

      bird.vy += (physics.gravity - lift) * dt;
      bird.vy = Math.max(
        -physics.maxRiseSpeed,
        Math.min(physics.maxFallSpeed, bird.vy),
      );
      bird.y += bird.vy * dt;

      spawn += dt;
      if (spawn >= game.pipeInterval) {
        spawn = 0;
        addPipe();
      }

      pipes.forEach((p) => {
        p.x -= game.pipeSpeed * dt;

        if (!p.passed && p.x + game.pipeWidth < bird.x) {
          p.passed = true;
          score++;
          $("score").textContent = score;
          if (score > best) {
            best = score;
            localStorage.setItem("gripbird-best", String(best));
            $("best").textContent = best;
          }
        }

        const within =
          bird.x + bird.r > p.x && bird.x - bird.r < p.x + game.pipeWidth;
        const touching =
          bird.y - bird.r < p.top || bird.y + bird.r > p.top + p.gap;

        if (within && touching) {
          endGame();
        }
      });

      pipes = pipes.filter((p) => p.x > -game.pipeWidth - 100);

      if (bird.y + bird.r > ground || bird.y - bird.r < 0) {
        endGame();
      }
    }

    draw();
    requestAnimationFrame(loop);
  }

  /*
   * TINDEQ PROGRESSOR
   */

  function parseNotification(value) {
    const bytes = new Uint8Array(
      value.buffer,
      value.byteOffset,
      value.byteLength,
    );

    let i = 0;

    while (i + 2 <= bytes.length) {
      const code = bytes[i];
      const len = bytes[i + 1];
      const start = i + 2;
      const end = start + len;

      if (end > bytes.length) break;

      if (code === 0x01) {
        for (let j = start; j + 8 <= end; j += 8) {
          const view = new DataView(bytes.buffer, bytes.byteOffset + j, 8);
          const kg = view.getFloat32(0, true);

          if (Number.isFinite(kg) && kg >= 0 && kg < 250) {
            rawForce = kg;
            const smoothing = Math.max(0, Math.min(1, CONFIG.force.smoothing));
            filteredForce = filteredForce * (1 - smoothing) + kg * smoothing;
            updateForceUI();
          }
        }
      } else if (code === 0x04) {
        setStatus("Attenzione: batteria del Tindeq Progressor scarica!");
      }

      i = end;
    }
  }

  async function sendCommand(opcode) {
    if (!controlChar) {
      throw new Error("Control Point non disponibile");
    }

    await controlChar.writeValue(new Uint8Array([opcode, 0]));
  }

  async function connect() {
    if (!navigator.bluetooth) {
      setStatus(
        "Bluetooth non supportato da questo browser. " +
          "Prova a utilizzare Google Chrome o Microsoft Edge " +
          "su computer, oppure Chrome su Android.",
      );

      return;
    }

    try {
      device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [CONFIG.ble.service] }],
        optionalServices: [CONFIG.ble.service],
      });

      device.addEventListener("gattserverdisconnected", () => {
        dataChar = null;
        controlChar = null;
        $("disconnect").disabled = true;
        updateStartButtonState();
        setState("Disconnesso");
        setStatus("Connessione Bluetooth interrotta.");
      });

      setStatus("Connessione al Progressor…");
      server = await device.gatt.connect();
      const service = await server.getPrimaryService(CONFIG.ble.service);
      dataChar = await service.getCharacteristic(CONFIG.ble.dataPoint);
      controlChar = await service.getCharacteristic(CONFIG.ble.controlPoint);
      await dataChar.startNotifications();

      dataChar.addEventListener("characteristicvaluechanged", (event) => {
        parseNotification(event.target.value);
      });

      $("disconnect").disabled = false;
      setState("Connesso");
      await sendCommand(CONFIG.ble.stopOpcode).catch(() => {});
      await sleep(CONFIG.ble.commandDelayMs);
      baseline = 0;
      filteredForce = 0;
      rawForce = 0;
      updateForceUI();
      await sendCommand(CONFIG.ble.startOpcode);
      setStatus(
        "Progressor connesso e misurazione avviata. Premi Inizia / riprova.",
      );
      updateStartButtonState();
    } catch (error) {
      setStatus("Connessione non riuscita: " + error.message);
    }
  }

  async function disconnect() {
    try {
      if (controlChar) {
        await sendCommand(CONFIG.ble.stopOpcode);
      }
    } catch (error) {
      // La disconnessione viene comunque tentata
    }

    if (device?.gatt?.connected) {
      device.gatt.disconnect();
    }
  }

  $("connect").addEventListener("click", connect);
  $("disconnect").addEventListener("click", disconnect);
  $("start").addEventListener("click", (event) => {
    event.stopPropagation();

    if ($("start").disabled || running || !isTindeqConnected()) {
      updateStartButtonState();
      return;
    }

    running = false;
    reset();
    $("start").disabled = true;
    $("start").textContent = CONFIG.messagges.buttonWaiting;

    setTimeout(() => {
      if (!isTindeqConnected()) {
        running = false;
        $("start").textContent = gameOver
          ? CONFIG.messagges.buttonRetry
          : CONFIG.messagges.buttonStart;
        $("start").hidden = false;
        updateStartButtonState();
        return;
      }
      running = true;
      $("start").hidden = true;
      updateStartButtonState();
    }, 500);
  });

  /*
   * PANNELLO DI REGOLAZIONE
   */

  const tuning = [
    ["maxKgInput", "maxKg", "maxKgOut", (v) => `${v} kg`],
    [
      "exponentInput",
      "responseExponent",
      "exponentOut",
      (v) => Number(v).toFixed(2).replace(".", ","),
    ],
    ["liftInput", "liftAcceleration", "liftOut", (v) => `${v} px/s²`],
    ["gravityInput", "gravity", "gravityOut", (v) => `${v} px/s²`],
    ["riseInput", "maxRiseSpeed", "riseOut", (v) => `${v} px/s`],
    ["fallInput", "maxFallSpeed", "fallOut", (v) => `${v} px/s`],
    [
      "pipeIntervalInput",
      "pipeInterval",
      "pipeIntervalOut",
      (v) => `${Number(v).toFixed(2).replace(".", ",")} s`,
    ],
    ["pipeWidthInput", "pipeWidth", "pipeWidthOut", (v) => `${v} px`],
  ];

  const initialTuning = {};

  tuning.forEach(([inputId, key, outputId, format]) => {
    initialTuning[key] =
      CONFIG.force[key] ?? CONFIG.physics[key] ?? CONFIG.gameplay[key];
    const input = $(inputId);
    const output = $(outputId);

    input.addEventListener("input", () => {
      const value = Number(input.value);

      if (key in CONFIG.force) CONFIG.force[key] = value;
      else if (key in CONFIG.physics) CONFIG.physics[key] = value;
      else CONFIG.gameplay[key] = value;

      output.textContent = format(value);
      updateForceUI();
    });

    output.textContent = format(input.value);
  });

  $("resetConfig").addEventListener("click", () => {
    tuning.forEach(([inputId, key, outputId, format]) => {
      const value = initialTuning[key];
      $(inputId).value = value;

      if (key in CONFIG.force) CONFIG.force[key] = value;
      else if (key in CONFIG.physics) CONFIG.physics[key] = value;
      else CONFIG.gameplay[key] = value;

      $(outputId).textContent = format(value);
    });

    updateForceUI();
  });

  // Stato iniziale
  reset();
  running = false;
  setState("Pronto");
  updateForceUI();
  $("resetConfig").click();
  requestAnimationFrame(loop);
})();
