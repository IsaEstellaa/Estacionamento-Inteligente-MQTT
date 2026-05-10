-- Quantidade de eventos processados
SELECT COUNT(*) FROM spot_events;

-- Quantas vagas ocupadas no momento
SELECT COUNT(*) 
FROM spots
WHERE currentState = 'OCCUPIED';

-- Quantidade de incidentes
SELECT COUNT(*)
FROM incidents;

-- Ocupação por setor
SELECT
  sectorId,
  COUNT(*) as total,
  SUM(CASE WHEN currentState='OCCUPIED' THEN 1 ELSE 0 END) as occupied
FROM spots
GROUP BY sectorId;