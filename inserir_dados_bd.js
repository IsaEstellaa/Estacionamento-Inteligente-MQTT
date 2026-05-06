import { initDB } from "./database.js";

async function seed() {
  console.log("Iniciando seed...");

  const db = await initDB();

  const sectors = ["A", "B", "C"];
  let total = 0;

  for (const sector of sectors) {
    for (let i = 1; i <= 30; i++) {
      const spotId = `${sector}-${String(i).padStart(2, "0")}`;

      await db.run(
        `INSERT OR IGNORE INTO spots (spotId, sectorId, currentState)
         VALUES (?, ?, ?)`,
        [spotId, sector, "FREE"]
      );

      total++;
    }
  }

  console.log(`Seed finalizado! ${total} vagas processadas.`);
  
  const result = await db.get("SELECT COUNT(*) as count FROM spots");
  console.log("Total no banco:", result.count);
}

seed();