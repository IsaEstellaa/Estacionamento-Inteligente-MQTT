import { initDB } from "./database.js";

async function check() {
  const db = await initDB();

  console.log("🔎 Tabelas:");
  const tables = await db.all(
    "SELECT name FROM sqlite_master WHERE type='table'"
  );
  console.log(tables);

  console.log("\n🚗 Algumas vagas:");
  const spots = await db.all("SELECT * FROM spots");
  console.log(spots);

  console.log("\n📊 Total de vagas:");
  const count = await db.get("SELECT COUNT(*) as total FROM spots");
  console.log(count);
}

check();