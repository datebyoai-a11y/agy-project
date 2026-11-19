const express = require('express');
const router = express.Router();
const Incident = require('../models/Incident');

// レベル0保存
router.post('/incident/level0', async (req, res) => {
  try {
    const combinedOccurrenceDate = new Date(`${req.body.occurrenceDateOnly}T${req.body.occurrenceTimeOnly}`);
    const loginId = req.session && req.session.user ? req.session.user.id : (req.user ? req.user.loginId : 'system');

    const newIncident = new Incident({
      level: "0",
      reportDate: req.body.reportDate,
      occurrenceDate: combinedOccurrenceDate,
      location: req.body.location,
      description: req.body.description,
      reporter: {
        loginId: loginId,
        name: req.body.reporterName,
        jobTitle: req.body.reporterJobTitle,
        department: req.body.reporterDepartment,
        experienceYears: req.body.reporterExperienceYears,
        isInvolved: req.body.reporterIsInvolved === "true"
      },
      patient: {
        targetPersonRef: req.body.targetPersonRef || null,
        name: req.body.patientName || "",
        id: req.body.patientId || "",
        age: req.body.patientAge ? Number(req.body.patientAge) : null,
        gender: req.body.patientGender || ""
      },
      eventCategory: req.body.eventCategory || "未分類（レベル0）",
      eventSummary: req.body.eventSummary || "未分類（レベル0）",
      causes: { environmentalPrimary: req.body.environmentalPrimary || "未選択", environmentalSecondary: req.body.environmentalSecondary || "" },
      postDiscoveryAction: req.body.postDiscoveryAction || "特記なし",
      detailedCauseDescription: req.body.detailedCauseDescription || "特記なし",
      resultStatus: req.body.resultStatus || "影響なし",
      countermeasure: req.body.countermeasure
    });
    await newIncident.save();
    res.send('<script>alert("レベル0 レポートを提出しました"); window.location.href="/incident/list";</script>');
  } catch (err) {
    res.status(500).send('データ保存エラー: ' + err.message);
  }
});

// レベル1以上保存
router.post('/incident/level1', async (req, res) => {
  try {
    const combinedOccurrenceDate = new Date(`${req.body.occurrenceDateOnly}T${req.body.occurrenceTimeOnly}`);
    const loginId = req.session && req.session.user ? req.session.user.id : (req.user ? req.user.loginId : 'system');

    const newIncident = new Incident({
      level: req.body.level,
      reportDate: req.body.reportDate,
      occurrenceDate: combinedOccurrenceDate,
      location: req.body.location,
      description: req.body.description,
      reporter: {
        loginId: loginId,
        name: req.body.reporterName,
        jobTitle: req.body.reporterJobTitle,
        department: req.body.reporterDepartment,
        experienceYears: req.body.reporterExperienceYears,
        isInvolved: req.body.reporterIsInvolved === "true"
      },
      patient: {
        targetPersonRef: req.body.targetPersonRef || null,
        name: req.body.patientName || "",
        id: req.body.patientId || "",
        age: req.body.patientAge ? Number(req.body.patientAge) : null,
        gender: req.body.patientGender || ""
      },
      eventCategory: req.body.eventCategory,
      eventSummary: req.body.eventSummary,
      tubeDetails: { type: req.body.tubeType || "", cause: req.body.tubeCause || "" },
      fallDetails: { triggerAction: req.body.fallTriggerAction || "", envFactor: req.body.fallEnvFactor || "", adl: req.body.fallAdl || "", careLevel: req.body.fallCareLevel || "" },
      causes: { environmentalPrimary: req.body.environmentalPrimary, environmentalSecondary: req.body.environmentalSecondary || "" },
      humanFactors: { primary: req.body.humanPrimary || "", secondary: req.body.humanSecondary || "" },
      postDiscoveryAction: req.body.postDiscoveryAction,
      detailedCauseDescription: req.body.detailedCauseDescription,
      resultStatus: req.body.resultStatus,
      countermeasure: req.body.countermeasure
    });
    await newIncident.save();
    res.send('<script>alert("レベル1以上 インシデントレポートを提出しました"); window.location.href="/incident/list";</script>');
  } catch (err) {
    res.status(500).send('データ保存エラー: ' + err.message);
  }
});

// レポートの修正更新
router.post('/incident/update/:id', async (req, res) => {
  try {
    const incident = await Incident.findById(req.params.id);
    if (!incident) return res.status(404).send('該当するレポートが見つかりません');
    
    const userLoginId = req.session && req.session.user ? req.session.user.id : (req.user ? req.user.loginId : null);
    if (userLoginId && incident.reporter.loginId !== userLoginId) {
      return res.send('<script>alert("ご自身が提出したレポート以外は修正できません。"); window.location.href="/incident/list";</script>');
    }

    const combinedOccurrenceDate = new Date(`${req.body.occurrenceDateOnly}T${req.body.occurrenceTimeOnly}`);
    const updateData = {
      level: req.body.level || "0",
      reportDate: req.body.reportDate,
      occurrenceDate: combinedOccurrenceDate,
      location: req.body.location,
      description: req.body.description,
      reporter: {
        loginId: incident.reporter.loginId,
        name: req.body.reporterName,
        jobTitle: req.body.reporterJobTitle,
        department: req.body.reporterDepartment,
        experienceYears: req.body.reporterExperienceYears,
        isInvolved: req.body.reporterIsInvolved === "true"
      },
      patient: {
        targetPersonRef: req.body.targetPersonRef || incident.patient?.targetPersonRef || null,
        name: req.body.patientName || "",
        id: req.body.patientId || "",
        age: req.body.patientAge ? Number(req.body.patientAge) : null,
        gender: req.body.patientGender || ""
      },
      eventCategory: req.body.eventCategory,
      eventSummary: req.body.eventSummary,
      tubeDetails: { type: req.body.tubeType || "", cause: req.body.tubeCause || "" },
      fallDetails: { triggerAction: req.body.fallTriggerAction || "", envFactor: req.body.fallEnvFactor || "", adl: req.body.fallAdl || "", careLevel: req.body.fallCareLevel || "" },
      causes: { environmentalPrimary: req.body.environmentalPrimary, environmentalSecondary: req.body.environmentalSecondary || "" },
      humanFactors: { primary: req.body.humanPrimary || "", secondary: req.body.humanSecondary || "" },
      postDiscoveryAction: req.body.postDiscoveryAction,
      detailedCauseDescription: req.body.detailedCauseDescription,
      resultStatus: req.body.resultStatus,
      countermeasure: req.body.countermeasure
    };
    
    await Incident.findByIdAndUpdate(req.params.id, updateData);
    res.send('<script>alert("レポートの修正を保存しました"); window.location.href="/incident/list";</script>');
  } catch (err) {
    res.status(500).send('データ更新エラー: ' + err.message);
  }
});

module.exports = router;
