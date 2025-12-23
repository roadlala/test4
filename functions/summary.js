export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "GET") {
    return jsonResponse({ ok: false, error: "方法不允许" }, 405);
  }

  if (!env.DIARY_KV) {
    return jsonResponse({
      ok: false,
      error: "KV 绑定未就绪。请在 Pages 设置中添加名为 DIARY_KV 的绑定。",
    }, 500);
  }

  const url = new URL(request.url);
  const daysParam = Number.parseInt(url.searchParams.get("days"), 10);
  const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 30;
  const cutoff = daysAgoISODate(days);

  const summary = {
    total: 0,
    byDate: {},
    byHeadache: { yes: 0, no: 0, unknown: 0 },
    bySeverity: { mild: 0, moderate: 0, severe: 0, unknown: 0 },
    byMedication: { yes: 0, no: 0, unknown: 0 },
    byOverall: { very_bad: 0, normal: 0, very_good: 0, unknown: 0 },
    byMedEffect: { none: 0, partial: 0, good: 0, unknown: 0 },
    bySensitivity: { light: 0, sound: 0 },
    bySymptoms: { nausea: 0, stomach: 0 },
    byCondition: {
      menstruation: 0,
      stress: 0,
      anxiety: 0,
      sleep: 0,
      no_meal: 0,
      other_disease: 0,
    },
    byConditionHeadache: {
      menstruation: 0,
      stress: 0,
      anxiety: 0,
      sleep: 0,
      no_meal: 0,
      other_disease: 0,
    },
    byActivity: { walk: 0, exercise: 0, meditation: 0, work: 0 },
    duration: { count: 0, sum: 0 },
    byDateHeadache: {},
    byDateDurationSum: {},
    byDateDurationCount: {},
    byDateSeverityMax: {},
    byDateMedYes: {},
  };

  let cursor;
  do {
    const listResult = await env.DIARY_KV.list({ prefix: "diary:", cursor });
    cursor = listResult.cursor;

    const filteredKeys = listResult.keys
      .map((item) => item.name)
      .filter((name) => isAfterCutoff(name, cutoff));

    if (filteredKeys.length === 0) {
      continue;
    }

    const values = await Promise.all(
      filteredKeys.map((key) => env.DIARY_KV.get(key, { type: "json" }))
    );
    for (let i = 0; i < filteredKeys.length; i += 1) {
      const entry = values[i];
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const recordDate = extractDateFromKey(filteredKeys[i]);
      if (!recordDate || recordDate < cutoff) {
        continue;
      }
      updateSummary(summary, recordDate, entry.data || {});
    }
  } while (cursor);

  return jsonResponse({ ok: true, summary, days });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json;charset=UTF-8" },
  });
}

function extractDateFromKey(key) {
  const parts = key.split(":");
  return parts.length >= 2 ? parts[1] : "";
}

function isAfterCutoff(key, cutoff) {
  const date = extractDateFromKey(key);
  return date && date >= cutoff;
}

function daysAgoISODate(days) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  now.setDate(now.getDate() - (days - 1));
  return now.toISOString().slice(0, 10);
}

function updateSummary(summary, recordDate, data) {
  summary.total += 1;
  summary.byDate[recordDate] = (summary.byDate[recordDate] || 0) + 1;

  const headache = getScalar(data.headache);
  if (headache === "yes") {
    summary.byHeadache.yes += 1;
    summary.byDateHeadache[recordDate] = (summary.byDateHeadache[recordDate] || 0) + 1;
  } else if (headache === "no") {
    summary.byHeadache.no += 1;
  } else {
    summary.byHeadache.unknown += 1;
  }

  const severity = getScalar(data.severity);
  if (severity === "mild") {
    summary.bySeverity.mild += 1;
  } else if (severity === "moderate") {
    summary.bySeverity.moderate += 1;
  } else if (severity === "severe") {
    summary.bySeverity.severe += 1;
  } else {
    summary.bySeverity.unknown += 1;
  }

  const medication = getScalar(data.medication);
  if (medication === "yes") {
    summary.byMedication.yes += 1;
    summary.byDateMedYes[recordDate] = (summary.byDateMedYes[recordDate] || 0) + 1;
  } else if (medication === "no") {
    summary.byMedication.no += 1;
  } else {
    summary.byMedication.unknown += 1;
  }

  const overall = getScalar(data.overall);
  if (overall === "very_bad") {
    summary.byOverall.very_bad += 1;
  } else if (overall === "normal") {
    summary.byOverall.normal += 1;
  } else if (overall === "very_good") {
    summary.byOverall.very_good += 1;
  } else {
    summary.byOverall.unknown += 1;
  }

  const medEffect = getScalar(data.med_effect);
  if (medEffect === "none") {
    summary.byMedEffect.none += 1;
  } else if (medEffect === "partial") {
    summary.byMedEffect.partial += 1;
  } else if (medEffect === "good") {
    summary.byMedEffect.good += 1;
  } else {
    summary.byMedEffect.unknown += 1;
  }

  incrementMulti(summary.bySensitivity, data.sensitivity);
  incrementMulti(summary.bySymptoms, data.symptoms);
  incrementMulti(summary.byCondition, data.condition);
  if (headache === "yes") {
    incrementMulti(summary.byConditionHeadache, data.condition);
  }
  incrementMulti(summary.byActivity, data.activity);

  const duration = Number.parseFloat(getScalar(data.duration));
  if (Number.isFinite(duration)) {
    summary.duration.count += 1;
    summary.duration.sum += duration;
    summary.byDateDurationSum[recordDate] = (summary.byDateDurationSum[recordDate] || 0) + duration;
    summary.byDateDurationCount[recordDate] = (summary.byDateDurationCount[recordDate] || 0) + 1;
  }

  const severityScore = toSeverityScore(severity);
  if (severityScore > 0) {
    const current = summary.byDateSeverityMax[recordDate] || 0;
    summary.byDateSeverityMax[recordDate] = Math.max(current, severityScore);
  }
}

function getScalar(value) {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function incrementMulti(store, value) {
  if (!value) {
    return;
  }
  const list = Array.isArray(value) ? value : [value];
  for (const item of list) {
    if (store[item] !== undefined) {
      store[item] += 1;
    }
  }
}

function toSeverityScore(severity) {
  if (severity === "mild") {
    return 1;
  }
  if (severity === "moderate") {
    return 2;
  }
  if (severity === "severe") {
    return 3;
  }
  return 0;
}
