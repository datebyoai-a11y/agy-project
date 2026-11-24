'use strict';

const fs = require('fs');
const path = require('path');
const { connectDB, closeDB } = require('./connection');
const medicineRepository = require('../repositories/medicineRepository');

const MASTER_JSON_PATH = path.join(__dirname, '..', '..', 'data', 'medicines.json');

async function seedInitialMedicines() {
  await medicineRepository.ensureIndexes();
  const existingCount = await medicineRepository.countAll();
  if (existingCount > 0) {
    await medicineRepository.backfillPrescriptionDefaults();
    return existingCount;
  }

  if (!fs.existsSync(MASTER_JSON_PATH)) {
    console.warn(`薬品マスタファイルが見つかりません: ${MASTER_JSON_PATH}`);
    return 0;
  }

  const raw = JSON.parse(fs.readFileSync(MASTER_JSON_PATH, 'utf8'));
  if (Array.isArray(raw) && raw.length > 0) {
    await medicineRepository.bulkSeed(raw);
    return raw.length;
  }
  return 0;
}

if (require.main === module) {
  connectDB()
    .then(() => seedInitialMedicines())
    .then((count) => {
      console.log(`薬品マスタ ${count} 件のシードが完了しました。`);
      return closeDB();
    })
    .catch((err) => {
      console.error('薬品マスタシードに失敗しました:', err);
      process.exit(1);
    });
}

module.exports = {
  seedInitialMedicines
};
