const express = require('express');
const router = express.Router();
const Incident = require('../models/Incident');

router.get('/incident/export/csv', async (req, res) => {
  try {
    const incidents = await Incident.find().sort({ createdAt: 1 });
    const headers = [
      'レベル', '提出年月日', '発生年月日', '発生時刻', '発生場所', '提出者氏名', '職種', '所属部署', '経験年数', '当事者フラグ',
      '当該者氏名', '当該者ID', '当該者年齢', '当該者性別', '出来事の領域', '出来事の概要', '発見後の対応', '原因（詳細）',
      '環境的主要因', '環境的副要因', '人為的主要因', '人為的副要因', '結果（影響度）', '今後の対策', '作成日時'
    ];

    const rows = incidents.map(item => {
      const rDate = item.reportDate ? item.reportDate.toISOString().split('T')[0] : '';
      const oDate = item.occurrenceDate ? item.occurrenceDate.toISOString().split('T')[0] : '';
      const oTime = item.occurrenceDate ? item.occurrenceDate.toTimeString().slice(0, 5) : '';
      const cDate = item.createdAt ? item.createdAt.toLocaleString('ja-JP') : '';
      const escape = (val) => {
        if (val === null || val === undefined) return '""';
        return `"${String(val).replace(/"/g, '""')}"`;
      };
      return [
        escape(item.level), escape(rDate), escape(oDate), escape(oTime), escape(item.location),
        escape(item.reporter ? item.reporter.name : ''), escape(item.reporter ? item.reporter.jobTitle : ''), escape(item.reporter ? item.reporter.department : ''), escape(item.reporter ? item.reporter.experienceYears : ''), escape(item.reporter && item.reporter.isInvolved ? '当事者' : '第三者'),
        escape(item.patient ? item.patient.name : ''), escape(item.patient ? item.patient.id : ''), escape(item.patient ? item.patient.age : ''), escape(item.patient ? item.patient.gender : ''),
        escape(item.eventCategory), escape(item.eventSummary), escape(item.postDiscoveryAction), escape(item.detailedCauseDescription),
        escape(item.causes ? item.causes.environmentalPrimary : ''), escape(item.causes ? item.causes.environmentalSecondary : ''), escape(item.humanFactors ? item.humanFactors.primary : ''), escape(item.humanFactors ? item.humanFactors.secondary : ''),
        escape(item.resultStatus), escape(item.countermeasure), escape(cDate)
      ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\r\n');
    const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
    const csvBuffer = Buffer.concat([bom, Buffer.from(csvContent, 'utf8')]);
    const filename = `incident_report_${new Date().toISOString().slice(0,10)}.csv`;
    
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csvBuffer);
  } catch (err) { res.status(500).send('CSV出力エラー: ' + err.message); }
});

module.exports = router;

