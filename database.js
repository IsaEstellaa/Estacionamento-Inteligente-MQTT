import sqlite3 from "sqlite3";
import { open } from "sqlite";

export async function initDB() {
  const db = await open({
    filename: "./parking.db",
    driver: sqlite3.Database
  });

  return db;
}

async function start() {
  console.log("Iniciando banco...");

  const db = await initDB();

  console.log("Banco conectado!");

  // 👉 CRIAR TABELAS
  await db.exec(`
    CREATE TABLE IF NOT EXISTS spots (
      spotId TEXT PRIMARY KEY,
      sectorId TEXT,
      currentState TEXT,
      lastChangeTs TEXT,
      lastEventId TEXT
    );

    CREATE TABLE IF NOT EXISTS spot_events (
      eventId TEXT PRIMARY KEY,
      ts TEXT,
      sectorId TEXT,
      spotId TEXT,
      state TEXT,
      rawPayloadJson TEXT
    );

    CREATE TABLE IF NOT EXISTS incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tsOpen TEXT,
      tsClose TEXT,
      type TEXT,
      severity TEXT,
      sectorId TEXT,
      spotId TEXT,
      evidenceJson TEXT,
      status TEXT
    );

    CREATE TABLE IF NOT EXISTS recommendations_log (
      ts TEXT,
      fromSector TEXT,
      recommendedSector TEXT,
      reason TEXT,
      dataJson TEXT
    );
  `);

  console.log("Tabelas criadas!");

  // 👉 TESTE
  const tables = await db.all(
    "SELECT name FROM sqlite_master WHERE type='table'"
  );

  console.log("Tabelas no banco:", tables);
}

start();