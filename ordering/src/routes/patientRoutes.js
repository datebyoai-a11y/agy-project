'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const patientRepository = require('../repositories/patientRepository');
const {
  PATIENT_CATEGORIES,
  GENDERS,
  BLOOD_TYPES,
  INSURANCE_TYPES,
  DIAGNOSIS_OUTCOMES,
  getSwitchableMenus
} = require('../config/constants');
const { formatActorForRecord } = require('../utils/actorHelper');

const router = express.Router();

const VALID_CATEGORIES = new Set(PATIENT_CATEGORIES.map((c) => c.code));
const VALID_GENDERS = new Set(GENDERS);
const VALID_BLOOD_TYPES = new Set(BLOOD_TYPES);
const VALID_OUTCOMES = new Set(['', ...DIAGNOSIS_OUTCOMES]);
const CATEGORY_LABEL_MAP = Object.fromEntries(PATIENT_CATEGORIES.map((c) => [c.code, c.name]));

function formatPatientForView(p) {
  return {
    ...p,
    careCategoryName: CATEGORY_LABEL_MAP[p.careCategory] || p.careCategory
  };
}

function buildStatusBarPatient(selected) {
  if (!selected) return null;
  return {
    id: `${selected.patientId} ${selected.fullName}`,
    birthDate: selected.birthDate || '----/--/--',
    age: selected.age != null ? selected.age : '--',
    allergies: selected.allergies || '',
    cautions: selected.cautions || ''
  };
}

function validatePatientInput(body, isCreate) {
  const patientId = String(body.patientId || '').trim();
  const fullName = String(body.fullName || '').trim();
  const kana = String(body.kana || '').trim();
  const birthDate = String(body.birthDate || '').trim();
  const gender = String(body.gender || '不明').trim();
  const careCategory = String(body.careCategory || 'outpatient').trim();
  const wardRoom = String(body.wardRoom || '').trim();
  const bloodType = String(body.bloodType || '不明').trim();
  const allergies = String(body.allergies || '').trim();
  const cautions = String(body.cautions || '').trim();
  const insuranceType = String(body.insuranceType || '').trim();
  const phone = String(body.phone || '').trim();
  const emergencyContact = String(body.emergencyContact || '').trim();
  const notes = String(body.notes || '').trim();
  const isActive = body.isActive !== false && body.isActive !== 'false';

  if (isCreate && (!patientId || !/^[a-zA-Z0-9_-]{2,24}$/.test(patientId))) {
    return { error: '患者IDは半角英数字・_-で2〜24文字で入力してください。' };
  }
  if (!fullName) {
    return { error: '氏名を入力してください。' };
  }
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    return { error: '生年月日を YYYY-MM-DD 形式で入力してください。' };
  }
  if (!VALID_GENDERS.has(gender)) {
    return { error: '性別が正しくありません。' };
  }
  if (!VALID_CATEGORIES.has(careCategory)) {
    return { error: '区分が正しくありません。' };
  }
  if (!VALID_BLOOD_TYPES.has(bloodType)) {
    return { error: '血液型が正しくありません。' };
  }

  const rawDiagnoses = Array.isArray(body.diagnoses) ? body.diagnoses : [];
  const diagnoses = [];
  for (let i = 0; i < rawDiagnoses.length; i += 1) {
    const item = rawDiagnoses[i] || {};
    const name = String(item.name || '').trim();
    const startDate = String(item.startDate || item.start_date || '').trim();
    const endDate = String(item.endDate || item.end_date || '').trim();
    const outcome = String(item.outcome || '継続').trim();

    if (!name && !startDate && !endDate) continue;
    if (!name) {
      return { error: `病名（${i + 1}行目）を入力してください。` };
    }
    if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      return { error: `病名「${name}」の開始日は YYYY-MM-DD 形式で入力してください。` };
    }
    if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return { error: `病名「${name}」の中止日は YYYY-MM-DD 形式で入力してください。` };
    }
    if (!VALID_OUTCOMES.has(outcome)) {
      return { error: `病名「${name}」の転帰が正しくありません。` };
    }
    diagnoses.push({
      diagnosis_id: String(item.diagnosisId || item.diagnosis_id || `DX-${Date.now()}-${i + 1}`).trim(),
      name,
      start_date: startDate,
      end_date: endDate,
      outcome: outcome || '継続'
    });
  }

  return {
    record: {
      patient_id: patientId,
      full_name: fullName,
      kana,
      birth_date: birthDate,
      gender,
      care_category: careCategory,
      ward_room: wardRoom,
      blood_type: bloodType,
      allergies,
      cautions,
      diagnoses,
      insurance_type: insuranceType,
      phone,
      emergency_contact: emergencyContact,
      notes,
      is_active: isActive
    }
  };
}

router.get('/patients', requireAuth, async (req, res, next) => {
  try {
    const patients = await patientRepository.findAll();
    const sessionUser = req.session.user;
    let selectedPatient = null;
    if (req.session.selectedPatient && req.session.selectedPatient.patientId) {
      selectedPatient =
        patients.find((p) => p.patientId === req.session.selectedPatient.patientId) ||
        req.session.selectedPatient;
      req.session.selectedPatient = formatPatientForView(selectedPatient);
    }

    res.render('patients', {
      statusBar: {
        screenTitle: '患者情報管理',
        patient: buildStatusBarPatient(selectedPatient),
        user: sessionUser,
        homePath: sessionUser.landingPath,
        switchableMenus: getSwitchableMenus(sessionUser)
      },
      patients: patients.map(formatPatientForView),
      categories: PATIENT_CATEGORIES,
      genders: GENDERS,
      bloodTypes: BLOOD_TYPES,
      insuranceTypes: INSURANCE_TYPES,
      diagnosisOutcomes: DIAGNOSIS_OUTCOMES,
      selectedPatientId: selectedPatient ? selectedPatient.patientId : ''
    });
  } catch (err) {
    next(err);
  }
});

router.get('/api/patients', requireAuth, async (req, res, next) => {
  try {
    const patients = await patientRepository.findAll();
    return res.json({ ok: true, patients: patients.map(formatPatientForView) });
  } catch (err) {
    next(err);
  }
});

router.get('/api/patients/:patientId', requireAuth, async (req, res, next) => {
  try {
    const patient = await patientRepository.findByPatientId(req.params.patientId);
    if (!patient) {
      return res.status(404).json({ ok: false, error: '対象患者が見つかりません。' });
    }
    return res.json({ ok: true, patient: formatPatientForView(patient) });
  } catch (err) {
    next(err);
  }
});

router.post('/api/patients', requireAuth, async (req, res, next) => {
  try {
    const validated = validatePatientInput(req.body, true);
    if (validated.error) {
      return res.status(400).json({ ok: false, error: validated.error });
    }

    const existing = await patientRepository.findByPatientId(validated.record.patient_id);
    if (existing) {
      return res.status(409).json({
        ok: false,
        error: `患者ID「${validated.record.patient_id}」は既に登録されています。`
      });
    }

    const created = await patientRepository.createPatient(
      validated.record,
      formatActorForRecord(req.session.user)
    );
    return res.status(201).json({ ok: true, patient: formatPatientForView(created) });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ ok: false, error: '同じ患者IDが既に存在します。' });
    }
    next(err);
  }
});

router.put('/api/patients/:patientId', requireAuth, async (req, res, next) => {
  try {
    const patientId = String(req.params.patientId || '').trim();
    const existing = await patientRepository.findByPatientId(patientId);
    if (!existing) {
      return res.status(404).json({ ok: false, error: '対象患者が見つかりません。' });
    }

    const validated = validatePatientInput(req.body, false);
    if (validated.error) {
      return res.status(400).json({ ok: false, error: validated.error });
    }

    const updated = await patientRepository.updatePatient(
      patientId,
      validated.record,
      formatActorForRecord(req.session.user)
    );

    if (req.session.selectedPatient && req.session.selectedPatient.patientId === patientId) {
      req.session.selectedPatient = formatPatientForView(updated);
    }

    return res.json({ ok: true, patient: formatPatientForView(updated) });
  } catch (err) {
    next(err);
  }
});

router.patch('/api/patients/:patientId/active', requireAuth, async (req, res, next) => {
  try {
    const patientId = String(req.params.patientId || '').trim();
    const isActive = req.body.isActive === true || req.body.isActive === 'true';

    const updated = await patientRepository.setPatientActive(
      patientId,
      isActive,
      formatActorForRecord(req.session.user)
    );
    if (!updated) {
      return res.status(404).json({ ok: false, error: '対象患者が見つかりません。' });
    }
    return res.json({ ok: true, patient: formatPatientForView(updated) });
  } catch (err) {
    next(err);
  }
});

router.post('/api/patients/:patientId/select', requireAuth, async (req, res, next) => {
  try {
    const patientId = String(req.params.patientId || '').trim();
    const patient = await patientRepository.findByPatientId(patientId);
    if (!patient) {
      return res.status(404).json({ ok: false, error: '対象患者が見つかりません。' });
    }
    const formatted = formatPatientForView(patient);
    req.session.selectedPatient = formatted;
    return res.json({ ok: true, patient: formatted });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
