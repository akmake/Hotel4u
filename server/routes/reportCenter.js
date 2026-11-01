// /api/pms/report-center — the hotel reports catalogue, any report as JSON, and its Excel/CSV file.
import { Router } from 'express';
import XLSX from 'xlsx';
import { assertPropertyScope, requireRoles, actorOrSystem } from '../middleware/authContext.js';
import { audit } from '../services/auditService.js';
import { catalog, runReport, toTable, REPORTS } from '../services/reportCenter.js';

const SENSITIVE = new Set(REPORTS.filter((r) => r.roles).map((r) => r.code));

const router = Router();
const ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'finance_manager', 'revenue_manager', 'housekeeping_manager', 'maintenance_manager', 'auditor', 'owner_readonly', 'cashier', 'receptionist'];

function scope(req) {
  const propertyId = req.query.propertyId || req.actor?.propertyId;
  if (!propertyId) { const err = new Error('יש לבחור נכס'); err.status = 400; throw err; }
  assertPropertyScope(req, propertyId);
  requireRoles(req, ROLES, 'אין הרשאה לדוחות');
  return String(propertyId);
}
const fail = (res, err) => {
  const status = Number(err?.status || 500);
  if (status >= 500) console.error('[report-center]', err);
  res.status(status).json({ success: false, error: status >= 500 ? 'שגיאת שרת — הדוח לא הופק' : err.message });
};

router.get('/catalog', (req, res) => {
  try { scope(req); res.json({ success: true, data: catalog(req.actor?.role) }); } catch (err) { fail(res, err); }
});

// Opening or exporting a report that shows ID numbers is recorded (who, which period, how).
function auditSensitive(req, report, how) {
  if (!SENSITIVE.has(report.code)) return;
  const a = actorOrSystem(req);
  audit({ property: req.query.propertyId || req.actor?.propertyId, actor: a.id, actorName: a.name, action: `report.${how}`, entityType: 'Report', entityId: undefined, after: { code: report.code, from: report.period.from, to: report.period.to, rows: report.rows.length, format: req.query.format || null }, ip: req.ip }).catch(() => null);
}

router.get('/:code', async (req, res) => {
  try {
    const report = await runReport({ propertyId: scope(req), code: req.params.code, query: req.query, role: req.actor?.role });
    auditSensitive(req, report, 'viewed');
    res.json({ success: true, data: report });
  } catch (err) { fail(res, err); }
});

router.get('/:code/export', async (req, res) => {
  try {
    const report = await runReport({ propertyId: scope(req), code: req.params.code, query: req.query, role: req.actor?.role });
    auditSensitive(req, report, 'exported');
    const head = [[report.name], [`${report.propertyName} · ${report.period.from === report.period.to ? report.period.from : `${report.period.from} – ${report.period.to}`}`], ...report.summary.map((s) => [s.label, s.value]), ...(report.note ? [[report.note]] : []), []];
    const aoa = [...head, ...toTable(report)];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const base = `${report.code}-${report.period.from}${report.period.to !== report.period.from ? `_${report.period.to}` : ''}`;
    if (req.query.format === 'csv') {
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${base}.csv"` });
      return res.send(`﻿${XLSX.utils.sheet_to_csv(ws)}`);
    }
    ws['!cols'] = report.columns.map((c, i) => ({ wch: Math.min(40, Math.max(String(c.label).length, ...aoa.slice(head.length).map((r) => String(r[i] ?? '').length)) + 2) }));
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, ws, report.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${base}.xlsx"` });
    return res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  } catch (err) { return fail(res, err); }
});

export default router;
