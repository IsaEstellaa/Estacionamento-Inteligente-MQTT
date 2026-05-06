import express from 'express';
import mqtt from 'mqtt';

const app = express();
app.use(express.json());

const PORT = 3000;

// estado em memória
const spots = {};

// inicializar 90 vagas
['A', 'B', 'C'].forEach(sector => {
  for (let i = 1; i <= 30; i++) {
    const spotId = `${sector}-${String(i).padStart(2, '0')}`;

    spots[spotId] = {
      sectorId: sector,
      state: 'FREE',
      ts: null
    };
  }
});

// conexão MQTT
const client = mqtt.connect('mqtt://localhost:1883');

client.on('connect', () => {
  console.log('✅ MQTT conectado');
  client.subscribe('campus/parking/#');
});

client.on('message', (topic, message) => {
  try {
    const data = JSON.parse(message.toString());

    spots[data.spotId] = {
        sectorId: data.sectorId,
        state: data.state,
        ts: data.ts
    };

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
    A: { occupied: 0, free: 0 },
    B: { occupied: 0, free: 0 },
    C: { occupied: 0, free: 0 }
  };

  Object.values(spots).forEach(spot => {
    if (spot.state === 'OCCUPIED') {
      sectors[spot.sectorId].occupied++;
    } else {
      sectors[spot.sectorId].free++;
    }
  });

  const result = Object.entries(sectors).map(([sectorId, data]) => {
    const total = data.occupied + data.free;
    const occupancyRate = total > 0 ? data.occupied / total : 0;

    return {
      sectorId,
      occupiedCount: data.occupied,
      freeCount: data.free,
      occupancyRate
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

app.listen(PORT, () => {
  console.log(`🚀 API rodando em http://localhost:${PORT}`);
});