'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const medicineRepository = require('../repositories/medicineRepository');
const patientRepository = require('../repositories/patientRepository');
const { getSwitchableMenus } = require('../config/constants');

const router = express.Router();

function buildStatusBarPatient(patient) {
  if (!patient) return null;
  return {
    id: `${patient.patientId} ${patient.fullName}`,
    birthDate: patient.birthDate || '----/--/--',
    age: patient.age != null ? patient.age : '--',
    allergies: patient.allergies || '',
    cautions: patient.cautions || ''
  };
}

/**
 * 薬剤検索画面 (GET /medicines)
 */
router.get('/medicines', requireAuth, async (req, res, next) => {
  try {
    const sessionUser = req.session.user;
    let selectedPatient = null;
    if (req.session.selectedPatient && req.session.selectedPatient.patientId) {
      selectedPatient =
        (await patientRepository.findByPatientId(req.session.selectedPatient.patientId)) ||
        req.session.selectedPatient;
      req.session.selectedPatient = selectedPatient;
    }

    const [categoryTree, totalCount, initialMedicines] = await Promise.all([
      medicineRepository.getCategoryTree(),
      medicineRepository.countAll(),
      medicineRepository.searchMedicines({ adoptType: 'ACTIVE' })
    ]);

    res.render('medicines', {
      statusBar: {
        screenTitle: '薬剤検索',
        patient: buildStatusBarPatient(selectedPatient),
        user: sessionUser,
        homePath: sessionUser.landingPath,
        switchableMenus: getSwitchableMenus(sessionUser)
      },
      categoryTree,
      totalCount,
      initialCount: initialMedicines.length,
      initialMedicines
    });
  } catch (err) {
    next(err);
  }
});

/**
 * API: 薬剤検索 (GET /api/medicines)
 */
router.get('/api/medicines', requireAuth, async (req, res, next) => {
  try {
    const {
      q = '',
      category = '',
      majorCategory = '',
      middleCategory = '',
      brandType = '',
      adoptType = 'ACTIVE',
      suspensionOk = '',
      crushOk = ''
    } = req.query;

    const medicines = await medicineRepository.searchMedicines({
      q,
      category,
      majorCategory,
      middleCategory,
      brandType,
      adoptType,
      suspensionOk,
      crushOk
    });

    res.set('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      count: medicines.length,
      medicines
    });
  } catch (err) {
    next(err);
  }
});

/**
 * API: 単一薬剤詳細＋同成分・同効薬 (GET /api/medicines/:drugId)
 */
router.get('/api/medicines/:drugId', requireAuth, async (req, res, next) => {
  try {
    const medicine = await medicineRepository.findByDrugId(req.params.drugId);
    if (!medicine) {
      return res.status(404).json({ ok: false, error: '対象薬剤が見つかりません。' });
    }
    const related = await medicineRepository.findRelatedMedicines(medicine);
    return res.json({
      ok: true,
      medicine,
      sameGeneric: related.sameGeneric,
      sameClass: related.sameClass
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
