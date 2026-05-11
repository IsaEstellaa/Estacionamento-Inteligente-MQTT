import { initDB } from './database.js';
import express from 'express';
import mqtt from 'mqtt';
import crypto from 'crypto';

const app = express();
app.use(express.json());

const PORT = 3000;
const db = await initDB();

// tempo simulado
const SIMULATION_MINUTE_MS = 1000; // 1s = 1 min

const STUCK_OCCUPIED_LIMIT = 24 * 1000;
const STUCK_FREE_LIMIT = 24 * 1000;

// estado em memória
const spots = {};
const incidents = [];

// inicializar as 90 vagas com base no banco de dados
const savedSpots = await db.all('SELECT * FROM spots');

savedSpots.forEach(spot => {
  spots[spot.spotId] = {
    sectorId: spot.sectorId,
    state: spot.currentState,
    ts: spot.lastChangeTs,
    lastChange: spot.lastChangeTs
    ? new Date(spot.lastChangeTs).getTime()
    : Date.now()
  };
});

console.log(`✅ ${savedSpots.length} vagas carregadas do banco`);

// conexão MQTT
const client = mqtt.connect('mqtt://localhost:1883');

client.on('connect', () => {
  console.log('✅ MQTT conectado');
  client.subscribe('campus/parking/#');
});

// função de criar incidente
async function createIncident(type, spot, spotId) {

  try {

    await db.run(
      `INSERT INTO incidents
      (tsOpen, type, severity, sectorId, spotId, evidenceJson, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        new Date().toISOString(),
        type,
        "HIGH",
        spot.sectorId,
        spotId,
        JSON.stringify({
          state: spot.state,
          lastChange: spot.lastChange
        }),
        "OPEN"
      ]
    );

    console.log(`🚨 INCIDENTE ${type} em ${spotId}`);

  } catch (err) {

    console.error("ERRO AO INSERIR INCIDENTE:");
    console.error(err.message);

  }
}

setInterval(() => {

  ['A', 'B', 'C'].forEach(sectorId => {

    client.publish(
      `campus/parking/sectors/${sectorId}/gateway/status`,
      JSON.stringify({
        sectorId,
        status: "ONLINE",
        ts: new Date().toISOString()
      })
    );

  });

}, 50000);

client.on('message', async (topic, message) => {
  try {

    if (!topic.includes('/spots/')) {
      return;
    }

    const data = JSON.parse(message.toString());

    const now = Date.now();

    const currentSpot = spots[data.spotId];

    // detectar flapping
    if (
      currentSpot &&
      currentSpot.state !== data.state &&
      currentSpot.lastChange &&
      (now - currentSpot.lastChange < 5000)
    ) {
      incidents.push({
        type: 'FLAPPING',
        spotId: data.spotId,
        sectorId: data.sectorId,
        ts: new Date().toISOString(),
        severity: 'HIGH'
      });

      await db.run(
        `INSERT INTO incidents
        (tsOpen, type, severity, sectorId, spotId, evidenceJson, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          new Date().toISOString(),
          'FLAPPING',
          'HIGH',
          data.sectorId,
          data.spotId,
          JSON.stringify(data),
          'OPEN'
        ]
      );

      console.log(`🚨 FLAPPING detectado em ${data.spotId}`);
    }

    await db.run(
      `INSERT OR IGNORE INTO spot_events
      (eventId, ts, sectorId, spotId, state, rawPayloadJson)
      VALUES (?, ?, ?, ?, ?, ?)`,
      [
        data.eventId,
        data.ts,
        data.sectorId,
        data.spotId,
        data.state,
        JSON.stringify(data)
      ]
    );

    // atualizar vaga
    spots[data.spotId] = {
      sectorId: data.sectorId,
      state: data.state,
      ts: data.ts,
      lastChange: now
    };

    await db.run(
      `UPDATE spots
      SET currentState = ?,
          lastChangeTs = ?,
          lastEventId = ?
      WHERE spotId = ?`,
      [
        data.state,
        data.ts,
        data.eventId,
        data.spotId
      ]
    );

    // Evento de vaga
    if (topic.includes('/spots/')) {
      console.log(`📍 ${data.spotId} → ${data.state}`);
    }
    // Gateway
    else if (topic.includes('/gateway/status')) {
      console.log(`📡 Gateway ${data.sectorId} = ${data.status}`);
    }

  } catch (err) {
    console.error('Erro:', err.message);
  }
});

// rota /map
app.get('/api/v1/map', (req, res) => {
  const sectors = {
    A: [],
    B: [],
    C: []
  };

  Object.entries(spots).forEach(([spotId, data]) => {
    sectors[data.sectorId].push({
      spotId,
      state: data.state
    });
  });

  const result = Object.entries(sectors).map(([sectorId, spots]) => ({
    sectorId,
    spots
  }));

  res.json({ sectors: result });
});

// rota /sectors
app.get('/api/v1/sectors', (req, res) => {
  const sectors = {
    A: { occupied: 0, free: 0, lastUpdateTs: null },
    B: { occupied: 0, free: 0, lastUpdateTs: null },
    C: { occupied: 0, free: 0, lastUpdateTs: null }
  };

  Object.values(spots).forEach(spot => {
    if (spot.state === 'OCCUPIED') {
      sectors[spot.sectorId].occupied++;
    } else {
      sectors[spot.sectorId].free++;
    }

    if (spot.ts) {
      sectors[spot.sectorId].lastUpdateTs = spot.ts;
    }
  });

  const result = Object.entries(sectors).map(([sectorId, data]) => {
    const totalSpots = data.occupied + data.free;

    return {
      sectorId,
      occupiedCount: data.occupied,
      freeCount: data.free,
      totalSpots,
      occupancyRate: data.occupied / totalSpots,
      lastUpdateTs: data.lastUpdateTs
    };
  });

  res.json(result);
});

app.get('/api/v1/sectors/:sectorId/spots', (req, res) => {

  const { sectorId } = req.params;

  if (!['A', 'B', 'C'].includes(sectorId)) {
    return res.status(400).json({
      error: 'Setor inválido'
    });
  }

  const sectorSpots = Object.entries(spots)
    .filter(([_, spot]) =>
      spot.sectorId === sectorId
    )
    .map(([spotId, spot]) => ({
      spotId,
      state: spot.state,
      lastChange: spot.lastChange
    }));

  res.json({
    sectorId,
    spots: sectorSpots
  });
});

app.get('/api/v1/sectors/:sectorId/free-spots', (req, res) => {
  const { sectorId } = req.params;
  const limit = parseInt(req.query.limit) || 30;

  // validar setor
  if (!['A', 'B', 'C'].includes(sectorId)) {
    return res.status(400).json({ error: 'Setor inválido' });
  }

  // filtrar vagas livres
  const freeSpots = Object.entries(spots)
    .filter(([_, data]) =>
      data.sectorId === sectorId && data.state === 'FREE'
    )
    .map(([spotId]) => spotId)
    .slice(0, limit);

  res.json({
    sectorId,
    freeSpots,
    count: freeSpots.length
  });
});

app.get('/api/v1/recommendation', async (req, res) => {
  const fromSector = req.query.fromSector;

  if (!['A', 'B', 'C'].includes(fromSector)) {
    return res.status(400).json({
      error: 'Setor inválido'
    });
  }

  // calcular ocupação dos setores
  const sectors = {};

  ['A', 'B', 'C'].forEach(sector => {
    const sectorSpots = Object.values(spots)
      .filter(spot => spot.sectorId === sector);

    const occupied = sectorSpots
      .filter(spot => spot.state === 'OCCUPIED').length;

    const free = sectorSpots
      .filter(spot => spot.state === 'FREE').length;

    sectors[sector] = {
      occupied,
      free,
      occupancyRate: occupied / (occupied + free)
    };
  });

  const currentSector = sectors[fromSector];

  // regra de 90%
  if (currentSector.occupancyRate < 0.9) {
    return res.json({
      message: `Setor ${fromSector} ainda não está lotado`
    });
  }

  // encontrar melhor setor
  const recommendation = Object.entries(sectors)
    .filter(([sector]) => sector !== fromSector)
    .sort((a, b) => b[1].free - a[1].free)[0];

  const [recommendedSector, data] = recommendation;

  const reason = `Setor ${fromSector} está com ${(currentSector.occupancyRate * 100).toFixed(0)}% de ocupação; o setor ${recommendedSector} possui ${data.free} vagas livres`;

  await db.run(
    `INSERT INTO recommendations_log
    (ts, fromSector, recommendedSector, reason, dataJson)
    VALUES (?, ?, ?, ?, ?)`,
    [
      new Date().toISOString(),
      fromSector,
      recommendedSector,
      reason,
      JSON.stringify({
        fromSector,
        recommendedSector
      })
    ]
  );

  res.json({
    fromSector,
    recommendedSector,
    message: `Setor ${fromSector} lotado. Vá para o setor ${recommendedSector}`,
    reason: reason,
    ts: new Date().toISOString()
  });
});

app.get('/api/v1/recommendations', async (req, res) => {
  const recommendations = await db.all(
    `SELECT * FROM recommendations_log
     ORDER BY ts DESC`
  );

  res.json(recommendations);
});

app.get('/api/v1/incidents', async (req, res) => {

  const { status } = req.query;

  let query = `
    SELECT *
    FROM incidents
  `;

  const params = [];

  if (status) {
    query += ` WHERE status = ?`;
    params.push(status);
  }

  query += ` ORDER BY tsOpen DESC`;

  const incidents = await db.all(query, params);

  res.json(incidents);
});

app.get('/api/v1/reports/turnover', async (req, res) => {

  const { sectorId, from, to } = req.query;

  // validar parâmetros
  if (!sectorId || !from || !to) {

    return res.status(400).json({
      error: 'Informe sectorId, from e to'
    });

  }

  try {

    // buscar eventos do setor
    const events = await db.all(
      `
      SELECT *
      FROM spot_events
      WHERE sectorId = ?
      AND ts BETWEEN ? AND ?
      ORDER BY spotId, ts
      `,
      [sectorId, from, to]
    );

    let turnover = 0;

    // percorre eventos
    for (let i = 1; i < events.length; i++) {

      const previous = events[i - 1];
      const current = events[i];

      // mesma vaga
      if (previous.spotId === current.spotId) {

        // FREE -> OCCUPIED
        if (
          previous.state === 'FREE' &&
          current.state === 'OCCUPIED'
        ) {

          turnover++;

        }
      }
    }

    res.json({
      sectorId,
      from,
      to,
      turnover
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: err.message
    });

  }

});

const reported = new Set();

setInterval(async () => {

  const now = Date.now();

  for (const [spotId, spot] of Object.entries(spots)) {

    const lastChange = spot.lastChange || now;
    const timeInState = now - lastChange;

    const keyOccupied = `${spotId}-STUCK_OCCUPIED`;
    const keyFree = `${spotId}-STUCK_FREE`;

    const isOccupiedStuck =
      spot.state === "OCCUPIED" &&
      timeInState > STUCK_OCCUPIED_LIMIT;

    const isFreeStuck =
      spot.state === "FREE" &&
      timeInState > STUCK_FREE_LIMIT;

    // 🟥 STUCK OCCUPIED
    if (isOccupiedStuck) {

      if (!reported.has(keyOccupied)) {
        await createIncident("STUCK_OCCUPIED", spot, spotId);
        reported.add(keyOccupied);
      }

    } else if (spot.state !== "OCCUPIED") {
      // só reseta quando muda de estado REALMENTE
      reported.delete(keyOccupied);
    }

    // 🟦 STUCK FREE
    if (isFreeStuck) {

      if (!reported.has(keyFree)) {
        await createIncident("STUCK_FREE", spot, spotId);
        reported.add(keyFree);
      }

    } else if (spot.state !== "FREE") {
      reported.delete(keyFree);
    }
  }

}, 5000);

// SIMULAÇÃO
let simulationEnabled = false;

// relógio simulado
let simulatedMinutes = 0;

// 1s = 1 minuto
setInterval(() => {

  simulatedMinutes += 60;

  // resetar depois de 24h
  if (simulatedMinutes >= 24 * 60) {
    simulatedMinutes = 0;
  }

}, 1000);

// retornar hora simulada
function simulatedHour() {
  return Math.floor(simulatedMinutes / 60);
}

// publicar evento MQTT
function publishSpotEvent(spotId, state) {

  const sectorId = spotId.split('-')[0];

  const payload = {
    eventId: crypto.randomUUID(),
    ts: new Date().toISOString(),
    sectorId,
    spotId,
    state,
    source: "simulation"
  };

  client.publish(
    `campus/parking/sectors/${sectorId}/spots/${spotId}/events`,
    JSON.stringify(payload)
  );

  console.log(`📤 SIMULAÇÃO → ${spotId} = ${state}`);
}

// ocupar vaga
function occupySpot(spotId) {

  const spot = spots[spotId];

  if (!spot) return;

  // evita ocupar vaga já ocupada
  if (spot.state === "OCCUPIED") return;

  publishSpotEvent(spotId, "OCCUPIED");
}

// liberar vaga
function freeSpot(spotId) {

  const spot = spots[spotId];

  if (!spot) return;

  // evita liberar vaga já livre
  if (spot.state === "FREE") return;

  publishSpotEvent(spotId, "FREE");
}

// simulação principal
function simulateParking() {

  const currentHour = simulatedHour();

  const minutes = simulatedMinutes % 60;

  console.log(
    `🕒 Hora simulada: ${String(currentHour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
  );

  // horários de pico
  const isPeak =
    (currentHour >= 7 && currentHour <= 9) ||
    (currentHour >= 17 && currentHour <= 19);

  for (const [spotId, spot] of Object.entries(spots)) {

    const random = Math.random();

    // ===============================
    // HORÁRIO DE PICO
    // ===============================
    if (isPeak) {

      // muita chegada
      if (
        spot.state === "FREE" &&
        random < 0.6
      ) {
        occupySpot(spotId);
      }

      // pouca saída
      if (
        spot.state === "OCCUPIED" &&
        random < 0.1
      ) {
        freeSpot(spotId);
      }

    }

    // ===============================
    // HORÁRIO NORMAL
    // ===============================
    else {

      // algumas chegadas
      if (
        spot.state === "FREE" &&
        random < 0.2
      ) {
        occupySpot(spotId);
      }

      // mais saídas
      if (
        spot.state === "OCCUPIED" &&
        random < 0.4
      ) {
        freeSpot(spotId);
      }
    }

    // ===============================
    // FLAPPING RARO
    // ===============================
    if (random < 0.01) {

      console.log(`⚠️ FLAPPING SIMULADO EM ${spotId}`);

      const currentState = spot.state;

      publishSpotEvent(
        spotId,
        currentState === "FREE"
          ? "OCCUPIED"
          : "FREE"
      );

      setTimeout(() => {

        publishSpotEvent(
          spotId,
          currentState
        );

      }, 1000);
    }
  }
}

// snapshot
setInterval(async () => {

  const sectors = {
    A: { occupied: 0, free: 0 },
    B: { occupied: 0, free: 0 },
    C: { occupied: 0, free: 0 }
  };

  Object.values(spots).forEach(spot => {

    if (spot.state === "OCCUPIED") {
      sectors[spot.sectorId].occupied++;
    } else {
      sectors[spot.sectorId].free++;
    }

  });

  for (const [sectorId, data] of Object.entries(sectors)) {

    const total = data.occupied + data.free;

    await db.run(
      `
      INSERT INTO sector_snapshots
      (ts, sectorId, occupiedCount, freeCount, occupancyRate)
      VALUES (?, ?, ?, ?, ?)
      `,
      [
        new Date().toISOString(),
        sectorId,
        data.occupied,
        data.free,
        data.occupied / total
      ]
    );

  }

  console.log("📸 Snapshot salvo");

}, 60000);

// iniciar simulação
app.post('/api/v1/simulation/start', (req, res) => {

  simulationEnabled = true;

  res.json({
    message: 'Simulação iniciada'
  });
});

// parar simulação
app.post('/api/v1/simulation/stop', (req, res) => {

  simulationEnabled = false;

  res.json({
    message: 'Simulação parada'
  });
});

// loop principal
setInterval(() => {

  if (!simulationEnabled) return;

  simulateParking();

}, 6000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 API rodando em http://localhost:${PORT}`);
});