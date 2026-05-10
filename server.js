import { initDB } from './database.js';
import express from 'express';
import mqtt from 'mqtt';

const app = express();
app.use(express.json());

const PORT = 3000;
const db = await initDB();

// estado em memória
const spots = {};
const incidents = [];

// inicializar 90 vagas
['A', 'B', 'C'].forEach(sector => {
  for (let i = 1; i <= 30; i++) {
    const spotId = `${sector}-${String(i).padStart(2, '0')}`;

    spots[spotId] = {
      sectorId: sector,
      state: 'FREE',
      ts: null,
      lastChange: Date.now()
    };
  }
});

// conexão MQTT
const client = mqtt.connect('mqtt://localhost:1883');

client.on('connect', () => {
  console.log('✅ MQTT conectado');
  client.subscribe('campus/parking/#');
});

client.on('message', async (topic, message) => {
  try {
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

    console.log(`📍 ${data.spotId} → ${data.state}`);

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

app.get('/api/v1/incidents', (req, res) => {
  res.json(incidents);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 API rodando em http://localhost:${PORT}`);
});