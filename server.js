const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

const TICK_RATE = 20;
const WORLD = { cols: 92, rows: 58 };
const MAX_ROOM_PLAYERS = 6;
const RECONNECT_GRACE_MS = 30000;
const ROOM_IDLE_DESTROY_MS = 10 * 60 * 1000;

const PLAYER_STYLES = [
  { emoji: "🦊", name: "Fox", color: "#215977", trailColor: "#69ddff", glow: "rgba(105,221,255,0.2)" },
  { emoji: "🐼", name: "Panda", color: "#693954", trailColor: "#ff9dbd", glow: "rgba(255,157,189,0.2)" },
  { emoji: "🐯", name: "Tiger", color: "#70511d", trailColor: "#ffd36a", glow: "rgba(255,211,106,0.2)" },
  { emoji: "🐸", name: "Frog", color: "#245d46", trailColor: "#80f0bc", glow: "rgba(128,240,188,0.2)" },
  { emoji: "🦄", name: "Unicorn", color: "#54458a", trailColor: "#c3a0ff", glow: "rgba(195,160,255,0.2)" },
  { emoji: "🐙", name: "Octopus", color: "#6c3b71", trailColor: "#ff90ec", glow: "rgba(255,144,236,0.2)" }
];

const CELL = { NEUTRAL: 0 };
const rooms = new Map();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomCode(length = 5) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function nowMs() {
  return Date.now();
}

function createRoom(maxPlayers) {
  let code = randomCode();
  while (rooms.has(code)) code = randomCode();

  const room = {
    code,
    ownerId: null,
    maxPlayers: clamp(maxPlayers || 3, 2, MAX_ROOM_PLAYERS),
    sockets: new Set(),
    players: [],
    enemies: [],
    grid: [],
    running: false,
    elapsed: 0,
    tick: 0,
    enemySpeedFactor: 1,
    nextEnemyAt: 18,
    maxEnemies: 7,
    lastTickAt: nowMs(),
    lastActiveAt: nowMs(),
    loop: null,
    winnerId: null,
    statusText: "Waiting for players"
  };

  room.loop = setInterval(() => updateRoom(room), 1000 / TICK_RATE);
  rooms.set(code, room);
  return room;
}

function destroyRoom(room) {
  clearInterval(room.loop);
  rooms.delete(room.code);
}

function touchRoom(room) {
  room.lastActiveAt = nowMs();
}

function getSpawnPositions(count) {
  const centerX = Math.floor(WORLD.cols / 2);
  const centerY = Math.floor(WORLD.rows / 2);
  const radiusX = Math.floor(WORLD.cols * 0.34);
  const radiusY = Math.floor(WORLD.rows * 0.3);
  const positions = [];

  for (let i = 0; i < count; i++) {
    const angle = (-Math.PI / 2) + (Math.PI * 2 * i / count);
    const x = Math.round(centerX + Math.cos(angle) * radiusX);
    const y = Math.round(centerY + Math.sin(angle) * radiusY);
    const towardX = centerX - x;
    const towardY = centerY - y;
    positions.push({
      x,
      y,
      dx: Math.abs(towardX) > Math.abs(towardY) ? Math.sign(towardX) : 0,
      dy: Math.abs(towardY) >= Math.abs(towardX) ? Math.sign(towardY) : 0
    });
  }

  return positions;
}

function buildPlayer(id, clientId, name, styleIndex, isBot = false) {
  const style = PLAYER_STYLES[(styleIndex - 1) % PLAYER_STYLES.length];
  return {
    id,
    clientId,
    reconnectToken: crypto.randomUUID(),
    name: name || style.name,
    emoji: style.emoji,
    color: style.color,
    trailColor: style.trailColor,
    glow: style.glow,
    safeCell: id * 2 - 1,
    trailCell: id * 2,
    isBot,
    connected: true,
    reconnectUntil: null,
    aiAssist: isBot,
    alive: true,
    outside: false,
    trail: [],
    trailSet: new Set(),
    trailBase: new Map(),
    x: 0,
    y: 0,
    dir: { x: 1, y: 0 },
    queuedDir: { x: 1, y: 0 },
    moveTimer: 0,
    speed: isBot ? 7.8 : 8.5,
    score: 0,
    areaPercent: 0,
    status: isBot ? "Bot Ready" : "Ready",
    aiTurnCooldown: 0
  };
}

function serializePlayer(player) {
  return {
    id: player.id,
    clientId: player.clientId,
    name: player.name,
    emoji: player.emoji,
    color: player.color,
    trailColor: player.trailColor,
    glow: player.glow,
    safeCell: player.safeCell,
    trailCell: player.trailCell,
    isBot: player.isBot,
    connected: player.connected,
    reconnecting: !player.connected && !player.isBot,
    reconnectUntil: player.reconnectUntil,
    aiAssist: player.aiAssist,
    alive: player.alive,
    outside: player.outside,
    x: player.x,
    y: player.y,
    dir: player.dir,
    score: Math.round(player.score),
    areaPercent: Number(player.areaPercent.toFixed(1)),
    status: player.status
  };
}

function findSafeOwner(room, cell) {
  return room.players.find((player) => player.safeCell === cell) || null;
}

function findTrailOwner(room, cell) {
  return room.players.find((player) => player.trailCell === cell) || null;
}

function resetMatch(room) {
  room.grid = Array.from({ length: WORLD.rows }, () => Array(WORLD.cols).fill(CELL.NEUTRAL));
  room.enemies = [];
  room.elapsed = 0;
  room.tick = 0;
  room.enemySpeedFactor = 1;
  room.nextEnemyAt = 18;
  room.winnerId = null;
  room.statusText = "Match started";
  room.lastTickAt = nowMs();

  const positions = getSpawnPositions(room.players.length);
  const zoneRadius = 5;

  room.players.forEach((player, index) => {
    const pos = positions[index];
    player.x = pos.x;
    player.y = pos.y;
    player.dir = { x: pos.dx, y: pos.dy };
    player.queuedDir = { ...player.dir };
    player.moveTimer = 0;
    player.alive = true;
    player.outside = false;
    player.trail = [];
    player.trailSet = new Set();
    player.trailBase = new Map();
    player.score = 0;
    player.areaPercent = 0;
    player.aiAssist = player.isBot || !player.connected;
    player.status = player.isBot ? "Bot Ready" : (player.connected ? "Ready" : "Reconnecting");

    for (let y = pos.y - zoneRadius; y <= pos.y + zoneRadius; y++) {
      for (let x = pos.x - zoneRadius; x <= pos.x + zoneRadius; x++) {
        if (x < 1 || y < 1 || x >= WORLD.cols - 1 || y >= WORLD.rows - 1) continue;
        if (Math.abs(x - pos.x) + Math.abs(y - pos.y) <= zoneRadius + 1) {
          room.grid[y][x] = player.safeCell;
        }
      }
    }
  });

  spawnEnemy(room);
  spawnEnemy(room);
  spawnEnemy(room);
  updateStats(room);
}

function spawnEnemy(room) {
  for (let tries = 0; tries < 300; tries++) {
    const x = Math.random() * (WORLD.cols - 6) + 3;
    const y = Math.random() * (WORLD.rows - 6) + 3;
    if (room.grid[Math.floor(y)][Math.floor(x)] !== CELL.NEUTRAL) continue;

    let okay = true;
    for (const player of room.players) {
      const dx = x - player.x;
      const dy = y - player.y;
      if ((dx * dx) + (dy * dy) < 140) {
        okay = false;
        break;
      }
    }
    if (!okay) continue;

    room.enemies.push({
      x,
      y,
      speed: 4.1,
      vx: Math.cos(Math.random() * Math.PI * 2),
      vy: Math.sin(Math.random() * Math.PI * 2)
    });
    return;
  }
}

function addTrailCell(room, player, x, y) {
  const key = `${x},${y}`;
  if (player.trailSet.has(key)) return;
  player.trailBase.set(key, room.grid[y][x]);
  player.trail.push({ x, y });
  player.trailSet.add(key);
  room.grid[y][x] = player.trailCell;
}

function clearTrail(room, player, toSafe) {
  for (const cell of player.trail) {
    const key = `${cell.x},${cell.y}`;
    const base = player.trailBase.get(key);
    room.grid[cell.y][cell.x] = toSafe ? player.safeCell : (base ?? CELL.NEUTRAL);
  }
  player.trail = [];
  player.trailSet.clear();
  player.trailBase.clear();
  player.outside = false;
}

function eliminatePlayer(room, player, reason) {
  if (!player || !player.alive || !room.running) return;
  player.alive = false;
  player.status = "Eliminated";
  clearTrail(room, player, false);
  room.statusText = reason;
}

function captureArea(room, player) {
  for (const cell of player.trail) {
    room.grid[cell.y][cell.x] = player.safeCell;
  }

  const visited = Array.from({ length: WORLD.rows }, () => Array(WORLD.cols).fill(false));
  const queue = [];

  const pushSeed = (x, y) => {
    if (x < 0 || y < 0 || x >= WORLD.cols || y >= WORLD.rows) return;
    if (visited[y][x]) return;
    if (room.grid[y][x] === player.safeCell) return;
    visited[y][x] = true;
    queue.push({ x, y });
  };

  for (const enemy of room.enemies) {
    pushSeed(Math.floor(enemy.x), Math.floor(enemy.y));
  }

  for (const rival of room.players) {
    if (rival !== player && rival.alive) pushSeed(rival.x, rival.y);
  }

  while (queue.length > 0) {
    const current = queue.shift();
    pushSeed(current.x + 1, current.y);
    pushSeed(current.x - 1, current.y);
    pushSeed(current.x, current.y + 1);
    pushSeed(current.x, current.y - 1);
  }

  let captured = 0;
  let stolen = 0;
  for (let y = 0; y < WORLD.rows; y++) {
    for (let x = 0; x < WORLD.cols; x++) {
      const cell = room.grid[y][x];
      if (cell === player.safeCell) continue;
      if (!visited[y][x]) {
        if (findSafeOwner(room, cell)) stolen++;
        room.grid[y][x] = player.safeCell;
        captured++;
      }
    }
  }

  player.score += captured * 10 + stolen * 8 + 120;
  player.status = stolen > 0 ? "Dominating" : "Captured";
  room.statusText = stolen > 0
    ? `${player.emoji} stole ${stolen} rival cells`
    : `${player.emoji} secured ${captured} cells`;
}

function updatePlayerBot(room, player, dt) {
  player.aiTurnCooldown -= dt;
  if (player.aiTurnCooldown > 0) return;
  player.aiTurnCooldown = 0.08 + Math.random() * 0.18;

  const directions = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 }
  ];

  let best = player.dir;
  let bestScore = -Infinity;

  for (const dir of directions) {
    if (dir.x === -player.dir.x && dir.y === -player.dir.y) continue;
    const nx = player.x + dir.x;
    const ny = player.y + dir.y;
    if (nx < 1 || ny < 1 || nx >= WORLD.cols - 1 || ny >= WORLD.rows - 1) continue;

    const cell = room.grid[ny][nx];
    let score = Math.random() * 0.6;
    const trailOwner = findTrailOwner(room, cell);
    const safeOwner = findSafeOwner(room, cell);

    if (cell === player.safeCell && !player.outside) score += 0.4;
    if (cell === CELL.NEUTRAL) score += player.outside ? 0.6 : 0.15;
    if (safeOwner && safeOwner !== player) score += 1.1;
    if (cell === player.safeCell && player.outside) score += 2.1;
    if (cell === player.trailCell) score -= 10;
    if (trailOwner && trailOwner !== player) score += 2.5;
    if (player.outside && player.trail.length > 9 && cell === player.safeCell) score += 2.1;

    if (score > bestScore) {
      bestScore = score;
      best = dir;
    }
  }

  player.queuedDir = best;
}

function updatePlayer(room, player, dt) {
  if (!player.alive) return;
  if (player.isBot || player.aiAssist) updatePlayerBot(room, player, dt);

  player.moveTimer += dt;
  const stepTime = 1 / player.speed;
  while (player.moveTimer >= stepTime) {
    player.moveTimer -= stepTime;
    player.dir = { ...player.queuedDir };
    const nextX = player.x + player.dir.x;
    const nextY = player.y + player.dir.y;
    if (nextX < 0 || nextY < 0 || nextX >= WORLD.cols || nextY >= WORLD.rows) return;

    const target = room.grid[nextY][nextX];
    player.x = nextX;
    player.y = nextY;

    const trailOwner = findTrailOwner(room, target);
    const safeOwner = findSafeOwner(room, target);

    if (trailOwner) {
      if (trailOwner === player) {
        eliminatePlayer(room, player, `${player.emoji} crossed their own trail.`);
        return;
      }
      eliminatePlayer(room, trailOwner, `${player.emoji} cut ${trailOwner.emoji}'s trail.`);
      return;
    }

    if (target === CELL.NEUTRAL || (safeOwner && safeOwner !== player)) {
      if (!player.outside) {
        player.outside = true;
        player.status = safeOwner && safeOwner !== player ? "Invading" : "Exposed";
      }
      addTrailCell(room, player, player.x, player.y);
      return;
    }

    if (target === player.safeCell) {
      if (player.outside && player.trail.length > 1) {
        captureArea(room, player);
        clearTrail(room, player, true);
        player.status = "Secured";
      } else {
        player.status = player.aiAssist && !player.isBot ? "Bot Assist" : "Safe";
      }
    }
  }
}

function enemyHitsClaimed(room, x, y) {
  const probes = [
    [Math.floor(x), Math.floor(y)],
    [Math.ceil(x), Math.floor(y)],
    [Math.floor(x), Math.ceil(y)],
    [Math.ceil(x), Math.ceil(y)]
  ];

  for (const [cx, cy] of probes) {
    if (cx < 0 || cy < 0 || cx >= WORLD.cols || cy >= WORLD.rows) return true;
    if (findSafeOwner(room, room.grid[cy][cx])) return true;
  }
  return false;
}

function moveEnemyAxis(room, enemy, axis, amount) {
  if (!amount) return;
  const next = enemy[axis] + amount;
  const sampleX = axis === "x" ? next : enemy.x;
  const sampleY = axis === "y" ? next : enemy.y;

  if (enemyHitsClaimed(room, sampleX, sampleY)) {
    enemy[axis === "x" ? "vx" : "vy"] *= -1;
    return;
  }

  enemy[axis] = next;
  const limit = axis === "x" ? WORLD.cols - 0.35 : WORLD.rows - 0.35;
  if (enemy[axis] < 0.35 || enemy[axis] > limit) {
    enemy[axis] = clamp(enemy[axis], 0.35, limit);
    enemy[axis === "x" ? "vx" : "vy"] *= -1;
  }
}

function updateEnemies(room, dt) {
  for (const enemy of room.enemies) {
    if (Math.random() < 0.018) {
      const angle = Math.random() * Math.PI * 2;
      enemy.vx = Math.cos(angle);
      enemy.vy = Math.sin(angle);
    }

    const speed = enemy.speed * room.enemySpeedFactor;
    moveEnemyAxis(room, enemy, "x", enemy.vx * speed * dt);
    moveEnemyAxis(room, enemy, "y", enemy.vy * speed * dt);

    const probes = [
      [Math.round(enemy.x), Math.round(enemy.y)],
      [Math.floor(enemy.x), Math.floor(enemy.y)],
      [Math.ceil(enemy.x), Math.ceil(enemy.y)]
    ];

    for (const [cx, cy] of probes) {
      if (cx < 0 || cy < 0 || cx >= WORLD.cols || cy >= WORLD.rows) continue;
      const owner = findTrailOwner(room, room.grid[cy][cx]);
      if (owner) {
        eliminatePlayer(room, owner, `Enemy broke through ${owner.emoji}'s trail.`);
      }
    }

    for (const player of room.players) {
      if (!player.alive) continue;
      const dx = enemy.x - player.x;
      const dy = enemy.y - player.y;
      if ((dx * dx) + (dy * dy) < 0.5) {
        eliminatePlayer(room, player, `${player.emoji} collided with an enemy.`);
      }
    }
  }
}

function updateStats(room) {
  const totalCells = WORLD.cols * WORLD.rows;
  const counts = new Map();
  room.players.forEach((player) => counts.set(player.id, 0));

  for (let y = 0; y < WORLD.rows; y++) {
    for (let x = 0; x < WORLD.cols; x++) {
      const owner = findSafeOwner(room, room.grid[y][x]);
      if (owner) counts.set(owner.id, counts.get(owner.id) + 1);
    }
  }

  for (const player of room.players) {
    player.areaPercent = (counts.get(player.id) / totalCells) * 100;
    if (player.alive) player.score += player.areaPercent * 0.012;
  }
}

function serializeRoomState(room) {
  return {
    type: "game_state",
    roomCode: room.code,
    running: room.running,
    elapsed: Number(room.elapsed.toFixed(2)),
    tick: room.tick,
    serverTime: nowMs(),
    statusText: room.statusText,
    reconnectGraceMs: RECONNECT_GRACE_MS,
    world: WORLD,
    grid: room.grid,
    players: room.players.map(serializePlayer),
    enemies: room.enemies.map((enemy, index) => ({
      id: index,
      x: enemy.x,
      y: enemy.y
    }))
  };
}

function send(socket, payload) {
  if (!socket || socket.destroyed || !socket.writable) return;
  const json = JSON.stringify(payload);
  const data = Buffer.from(json);
  let header;

  if (data.length < 126) {
    header = Buffer.from([0x81, data.length]);
  } else if (data.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }

  socket.write(Buffer.concat([header, data]));
}

function broadcastRoom(room, payload) {
  for (const socket of room.sockets) {
    send(socket, payload);
  }
}

function sendLobbyState(room) {
  broadcastRoom(room, {
    type: "lobby_state",
    roomCode: room.code,
    ownerId: room.ownerId,
    maxPlayers: room.maxPlayers,
    running: room.running,
    players: room.players.map(serializePlayer),
    statusText: room.statusText
  });
}

function checkRoomEnd(room) {
  const alivePlayers = room.players.filter((player) => player.alive);
  if (alivePlayers.length > 1) return;

  room.running = false;
  const ranking = [...room.players].sort((a, b) => {
    if (b.areaPercent !== a.areaPercent) return b.areaPercent - a.areaPercent;
    return b.score - a.score;
  });

  const winner = alivePlayers[0] || ranking[0] || null;
  room.winnerId = winner ? winner.id : null;
  room.statusText = winner ? `${winner.emoji} wins the arena` : "Match ended";

  broadcastRoom(room, {
    type: "game_over",
    roomCode: room.code,
    winnerId: room.winnerId,
    statusText: room.statusText,
    ranking: ranking.map(serializePlayer)
  });
}

function reclaimExpiredDisconnectedPlayers(room) {
  const now = nowMs();
  let lobbyChanged = false;

  for (const player of room.players) {
    if (player.connected || player.reconnectUntil == null) continue;

    if (player.reconnectUntil > now) {
      player.aiAssist = true;
      if (!player.isBot) {
        player.status = room.running ? "Bot Assist" : "Reconnecting";
      }
      continue;
    }

    if (!room.running) {
      lobbyChanged = true;
    } else if (!player.isBot) {
      player.isBot = true;
      player.aiAssist = true;
      player.connected = false;
      player.status = "Bot Takeover";
    }
    player.reconnectUntil = null;
  }

  if (!room.running && lobbyChanged) {
    room.players = room.players.filter((player) => player.connected || player.isBot);
    reindexPlayers(room);
    sendLobbyState(room);
  }
}

function reindexPlayers(room) {
  room.players.forEach((player, index) => {
    player.id = index + 1;
    player.safeCell = player.id * 2 - 1;
    player.trailCell = player.id * 2;
  });

  if (!room.players.find((player) => player.id === room.ownerId)) {
    const firstHuman = room.players.find((player) => !player.isBot) || room.players[0] || null;
    room.ownerId = firstHuman ? firstHuman.id : null;
  }
}

function updateRoom(room) {
  reclaimExpiredDisconnectedPlayers(room);

  if (!room.running) {
    if (room.sockets.size === 0 && nowMs() - room.lastActiveAt > ROOM_IDLE_DESTROY_MS) {
      destroyRoom(room);
    }
    return;
  }

  const now = nowMs();
  const dt = Math.min(0.05, (now - room.lastTickAt) / 1000);
  room.lastTickAt = now;
  room.elapsed += dt;
  room.tick += 1;

  for (const player of room.players) updatePlayer(room, player, dt);
  updateEnemies(room, dt);

  const level = Math.floor(room.elapsed / 18);
  room.enemySpeedFactor = 1 + level * 0.07;
  if (room.elapsed >= room.nextEnemyAt && room.enemies.length < room.maxEnemies) {
    spawnEnemy(room);
    room.nextEnemyAt += 18;
    room.statusText = "A new enemy entered the arena.";
  }

  updateStats(room);
  broadcastRoom(room, serializeRoomState(room));
  checkRoomEnd(room);
}

function attachClientToRoom(socket, room, player) {
  socket.roomCode = room.code;
  socket.playerId = player.id;
  socket.rejoinToken = player.reconnectToken;
  room.sockets.add(socket);
  if (!room.ownerId) room.ownerId = player.id;
  touchRoom(room);
  send(socket, {
    type: "joined",
    roomCode: room.code,
    playerId: player.id,
    rejoinToken: player.reconnectToken
  });
  sendLobbyState(room);
  if (room.running) {
    send(socket, serializeRoomState(room));
  }
}

function createHumanPlayer(room, socket, name) {
  const nextId = room.players.length + 1;
  const player = buildPlayer(nextId, socket.clientId, name, nextId, false);
  room.players.push(player);
  return player;
}

function addBotsIfNeeded(room) {
  while (room.players.length < room.maxPlayers) {
    const nextId = room.players.length + 1;
    room.players.push(buildPlayer(nextId, `bot-${nextId}`, `Bot ${nextId}`, nextId, true));
  }
}

function tryRejoinRoom(socket, roomCode, token) {
  const room = rooms.get(String(roomCode || "").toUpperCase());
  if (!room) {
    send(socket, { type: "error", message: "Saved room no longer exists." });
    return false;
  }

  const player = room.players.find((entry) => entry.reconnectToken === token);
  if (!player) {
    send(socket, { type: "error", message: "Saved session expired. Join the room again." });
    return false;
  }

  player.clientId = socket.clientId;
  player.connected = true;
  player.aiAssist = player.isBot;
  player.reconnectUntil = null;
  if (!player.isBot) {
    player.status = room.running ? "Recovered" : "Ready";
  }

  attachClientToRoom(socket, room, player);
  send(socket, { type: "rejoined", roomCode: room.code, playerId: player.id, rejoinToken: player.reconnectToken });
  return true;
}

function handleMessage(socket, message) {
  let data;
  try {
    data = JSON.parse(message);
  } catch {
    send(socket, { type: "error", message: "Invalid JSON payload." });
    return;
  }

  if (data.type === "ping") {
    send(socket, { type: "pong", sentAt: data.sentAt, serverTime: nowMs() });
    return;
  }

  if (data.type === "rejoin_room") {
    tryRejoinRoom(socket, data.roomCode, data.rejoinToken);
    return;
  }

  if (data.type === "create_room") {
    const room = createRoom(data.maxPlayers);
    const player = createHumanPlayer(room, socket, data.name || "Host");
    attachClientToRoom(socket, room, player);
    return;
  }

  if (data.type === "join_room") {
    const room = rooms.get(String(data.roomCode || "").toUpperCase());
    if (!room) {
      send(socket, { type: "error", message: "Room not found." });
      return;
    }
    if (room.running) {
      send(socket, { type: "error", message: "Match already started. Try rejoin if this was your room." });
      return;
    }
    if (room.players.filter((player) => !player.isBot).length >= room.maxPlayers) {
      send(socket, { type: "error", message: "Room is full." });
      return;
    }
    const player = createHumanPlayer(room, socket, data.name || `Player ${room.players.length + 1}`);
    attachClientToRoom(socket, room, player);
    return;
  }

  const room = rooms.get(socket.roomCode);
  if (!room) return;
  touchRoom(room);

  if (data.type === "start_match") {
    if (socket.playerId !== room.ownerId) {
      send(socket, { type: "error", message: "Only the room owner can start the match." });
      return;
    }
    if (room.players.length < 2) {
      send(socket, { type: "error", message: "Need at least 2 players or bots to start." });
      return;
    }
    addBotsIfNeeded(room);
    resetMatch(room);
    room.running = true;
    room.lastTickAt = nowMs();
    sendLobbyState(room);
    return;
  }

  if (data.type === "input") {
    const player = room.players.find((entry) => entry.id === socket.playerId);
    if (!player || !player.alive || player.isBot || !player.connected) return;
    const dir = data.dir || {};
    const x = clamp(Number(dir.x) || 0, -1, 1);
    const y = clamp(Number(dir.y) || 0, -1, 1);
    if ((x !== 0 && y !== 0) || (x === 0 && y === 0)) return;

    if (x !== 0 && player.dir.x !== 0) {
      player.queuedDir = { x, y: 0 };
    } else if (y !== 0 && player.dir.y !== 0) {
      player.queuedDir = { x: 0, y };
    } else {
      player.queuedDir = { x, y };
    }
  }
}

function removeSocket(socket) {
  const room = rooms.get(socket.roomCode);
  if (!room) return;

  room.sockets.delete(socket);
  touchRoom(room);

  const player = room.players.find((entry) => entry.id === socket.playerId);
  if (player && !player.isBot) {
    player.connected = false;
    player.reconnectUntil = nowMs() + RECONNECT_GRACE_MS;
    player.aiAssist = room.running;
    player.status = room.running ? "Reconnecting" : "Left Lobby";

    if (!room.running) {
      if (room.ownerId === player.id) {
        const nextOwner = room.players.find((entry) => entry !== player && entry.connected && !entry.isBot);
        if (nextOwner) room.ownerId = nextOwner.id;
      }
      sendLobbyState(room);
    }
  }

  if (room.sockets.size === 0 && !room.running && room.players.every((entry) => !entry.connected || entry.isBot)) {
    room.lastActiveAt = nowMs() - ROOM_IDLE_DESTROY_MS;
  }
}

function parseFrames(buffer) {
  const messages = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = Boolean(second & 0x80);
    let payloadLength = second & 0x7f;
    let headerLength = 2;

    if (payloadLength === 126) {
      if (offset + 4 > buffer.length) break;
      payloadLength = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (payloadLength === 127) {
      if (offset + 10 > buffer.length) break;
      payloadLength = Number(buffer.readBigUInt64BE(offset + 2));
      headerLength = 10;
    }

    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + payloadLength;
    if (offset + frameLength > buffer.length) break;

    let payload = buffer.slice(offset + headerLength + maskLength, offset + frameLength);
    if (masked) {
      const mask = buffer.slice(offset + headerLength, offset + headerLength + 4);
      const unmasked = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) {
        unmasked[i] = payload[i] ^ mask[i % 4];
      }
      payload = unmasked;
    }

    messages.push({ opcode, payload: payload.toString("utf8") });
    offset += frameLength;
  }

  return { messages, rest: buffer.slice(offset) };
}

function serveFile(filePath, res) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    const type = {
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".webmanifest": "application/manifest+json; charset=utf-8",
      ".png": "image/png"
    }[ext] || "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600"
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }

  const pathname = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const safePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!safePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  serveFile(safePath, res);
});

server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  socket.clientId = crypto.randomUUID();
  let buffer = Buffer.alloc(0);

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const parsed = parseFrames(buffer);
    buffer = parsed.rest;
    for (const frame of parsed.messages) {
      if (frame.opcode === 0x8) {
        socket.end();
        return;
      }
      if (frame.opcode === 0x1) {
        handleMessage(socket, frame.payload);
      }
    }
  });

  socket.on("close", () => removeSocket(socket));
  socket.on("end", () => removeSocket(socket));
  socket.on("error", () => removeSocket(socket));

  send(socket, { type: "connected", clientId: socket.clientId, serverTime: nowMs() });
});

server.listen(PORT, () => {
  console.log(`Zone Clash Arena server running at http://localhost:${PORT}`);
});
