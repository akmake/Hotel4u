const DEFAULTS = {
  leadStaleDays: 7,
  leadDueGraceHours: 0,
  leadHighScoreThreshold: 65,
  leadHighScoreUnassignedEscalationHours: 24,
  leadAttentionScoreThreshold: 85,
  oppAtRiskInactiveDays: 14,
  oppStalledInactiveDays: 30,
  oppOverdueCloseEscalationDays: 0,
  oppAttentionScoreThreshold: 24,
};

function toNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min = 0, max = Number.POSITIVE_INFINITY) {
  return Math.min(max, Math.max(min, value));
}

export const CRM_SLA_DEFAULTS = Object.freeze(DEFAULTS);

export function normalizeCrmSla(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    leadStaleDays: clamp(Math.round(toNumber(source.leadStaleDays, DEFAULTS.leadStaleDays)), 1, 365),
    leadDueGraceHours: clamp(Math.round(toNumber(source.leadDueGraceHours, DEFAULTS.leadDueGraceHours)), 0, 168),
    leadHighScoreThreshold: clamp(Math.round(toNumber(source.leadHighScoreThreshold, DEFAULTS.leadHighScoreThreshold)), 0, 100),
    leadHighScoreUnassignedEscalationHours: clamp(Math.round(toNumber(
      source.leadHighScoreUnassignedEscalationHours,
      DEFAULTS.leadHighScoreUnassignedEscalationHours
    )), 0, 168),
    leadAttentionScoreThreshold: clamp(Math.round(toNumber(source.leadAttentionScoreThreshold, DEFAULTS.leadAttentionScoreThreshold)), 0, 200),
    oppAtRiskInactiveDays: clamp(Math.round(toNumber(source.oppAtRiskInactiveDays, DEFAULTS.oppAtRiskInactiveDays)), 1, 365),
    oppStalledInactiveDays: clamp(Math.round(toNumber(source.oppStalledInactiveDays, DEFAULTS.oppStalledInactiveDays)), 1, 365),
    oppOverdueCloseEscalationDays: clamp(Math.round(toNumber(source.oppOverdueCloseEscalationDays, DEFAULTS.oppOverdueCloseEscalationDays)), 0, 365),
    oppAttentionScoreThreshold: clamp(Math.round(toNumber(source.oppAttentionScoreThreshold, DEFAULTS.oppAttentionScoreThreshold)), 0, 300),
  };
}

