export const TERMS = ["Fall", "Winter", "Spring"];
export const STANDINGS = ["Freshman", "Sophomore", "Junior", "Senior"];
export const FORMATS = ["In person", "Hybrid", "Remote"];

export const INTERESTS = [
  { id: "writing", label: "Writing & literature", test: /creative writing|literature|poetry|poetics|fiction|journalism|rhetoric|publishing|memoir|storytell/i },
  { id: "law", label: "Law & public policy", test: /\blaw\b|legal|justice|public policy|government|constitutional|supreme court|legislati|civic/i },
  { id: "politics", label: "Politics & history", test: /politic|history|historical|political economy|social movement|democra|international studies/i },
  { id: "arts", label: "Art & design", test: /visual art|design|printmaking|ceramic|photograph|weav|film|cinema|sculpt|drawing/i },
  { id: "music", label: "Music & performance", test: /music|perform|theat|drama|acting|sing|dance|voice/i },
  { id: "psychology", label: "Psychology & society", test: /psycholog|sociolog|anthropolog|social work|social identit|human behavior/i },
  { id: "education", label: "Education & teaching", test: /educat|teach|pedagog|curricul|school|classroom/i },
  { id: "environment", label: "Environment & climate", test: /environment|ecolog|climate|conserv|natural resource|marine|sustainab/i },
  { id: "food", label: "Food & farming", test: /agricultur|farm|food|horticultur|garden|botany|soil/i },
  { id: "indigenous", label: "Indigenous studies", test: /native american|indigenous|tribal|coast salish|first nations/i },
  { id: "technology", label: "Technology & AI", test: /computer science|technology|\bai\b|artificial intelligence|data science|programming|digital media/i },
  { id: "business", label: "Business & nonprofits", test: /business|entrepreneur|economics|management|nonprofit|leadership|organizational/i },
  { id: "science", label: "Science & health", test: /biology|chemistry|physics|health|medicine|geology|astronomy|science/i },
  { id: "languages", label: "Language & culture", test: /language|linguistic|cultural studies|world cinema|translation|spanish|french|chinese/i },
  { id: "mathematics", label: "Math & statistics", test: /\bmath\b|mathematic|statistics|quantitative|calculus|algebra|probabilit/i },
];

export function offeringAvailable(course, term, prefs) {
  if (!course.offerings?.[term] || !course.standings?.includes(prefs.standing)) return false;
  if (/closed|cancel/i.test(course.offerings[term].status || "")) return false;
  const mode = course.modes?.[term];
  if (mode && !prefs.formats.includes(mode)) return false;
  if (prefs.location && prefs.location !== "Any location" && course.location !== prefs.location && mode !== "Remote") return false;
  return (course.credits || []).length > 0;
}

export function meetingsOverlap(a, b) {
  if (a.day !== b.day || a.start >= b.end || b.start >= a.end) return false;
  return !a.weeks || !b.weeks || a.weeks.some(week => b.weeks.includes(week));
}

export function courseConflict(a, b, term) {
  return (a.meetings?.[term] || []).some(x => (b.meetings?.[term] || []).some(y => meetingsOverlap(x, y)));
}

function clockTime(minute, showMeridiem = true) {
  const hour = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${hour % 12 || 12}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}${showMeridiem ? hour >= 12 ? 'pm' : 'am' : ''}`;
}

function timeRange(start, end) {
  const sameMeridiem = (start < 720) === (end < 720);
  return `${clockTime(start, !sameMeridiem)}–${clockTime(end)}`;
}

function weekRange(weeks) {
  const sorted = [...new Set(weeks)].sort((a, b) => a - b);
  const ranges = [];
  for (const week of sorted) {
    const last = ranges.at(-1);
    if (last && week === last[1] + 1) last[1] = week;
    else ranges.push([week, week]);
  }
  return ranges.map(([start, end]) => start === end ? String(start) : `${start}–${end}`).join(', ');
}

const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SHORT_DAY = { Mon: 'M', Tue: 'Tu', Wed: 'W', Thu: 'Th', Fri: 'F', Sat: 'Sa', Sun: 'Su' };

export function compactMeetingTimes(course, term) {
  const meetings = course.meetings?.[term] || [];
  if (!meetings.length) return 'Meeting times not published';
  const groups = new Map();
  for (const meeting of meetings) {
    const key = `${meeting.start}-${meeting.end}`;
    if (!groups.has(key)) groups.set(key, { start: meeting.start, end: meeting.end, days: new Set() });
    groups.get(key).days.add(meeting.day);
  }
  return [...groups.values()]
    .sort((a, b) => Math.min(...[...a.days].map(day => DAY_ORDER.indexOf(day))) - Math.min(...[...b.days].map(day => DAY_ORDER.indexOf(day))) || a.start - b.start)
    .map(group => `${[...group.days].sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b)).map(day => SHORT_DAY[day] || day).join('/')} ${timeRange(group.start, group.end)}`)
    .join(' · ');
}

function overlapTimes(a, b, term) {
  const details = new Set();
  for (const left of a.meetings?.[term] || []) {
    for (const right of b.meetings?.[term] || []) {
      if (!meetingsOverlap(left, right)) continue;
      const weeks = left.weeks && right.weeks ? left.weeks.filter(week => right.weeks.includes(week)) : null;
      const weekText = weeks?.length ? ` (week${weeks.length === 1 ? '' : 's'} ${weekRange(weeks)})` : '';
      details.add(`${left.day} ${timeRange(Math.max(left.start, right.start), Math.min(left.end, right.end))}${weekText}`);
    }
  }
  return [...details];
}

export function planIssues(plan, courses, target) {
  const byId = new Map(courses.map(course => [course.id, course]));
  const issues = [];
  for (const term of TERMS) {
    const entries = (plan[term] || []).filter(item => byId.has(item.id));
    const total = entries.reduce((sum, item) => sum + item.credits, 0);
    if (total > target && total <= 20) issues.push({ term, kind: "target", text: `${term}: ${total} credits is above your ${target}-credit planning target.` });
    if (total > 20) issues.push({ term, kind: "over", text: `${term}: ${total} credits exceeds Evergreen’s usual 20-credit limit.` });
    for (let i = 0; i < entries.length; i++) {
      const a = byId.get(entries[i].id);
      if (!(a.meetings?.[term] || []).length) issues.push({ term, kind: "unknown", text: `${a.title}: weekly meeting times are not published here; check before relying on this combination.` });
      if (/conditional/i.test(a.offerings?.[term]?.status || "")) issues.push({ term, kind: "unknown", text: `${a.title}: ${term} entry is conditional; confirm with Evergreen.` });
      if (a.prerequisites && !/^none\b|^no prerequisites/i.test(a.prerequisites)) issues.push({ term, kind: "unknown", text: `${a.title}: check the entry requirements on the official listing.` });
      for (let j = i + 1; j < entries.length; j++) {
        const b = byId.get(entries[j].id);
        const overlaps = overlapTimes(a, b, term);
        if (overlaps.length) issues.push({ term, kind: "clash", text: `${term}: ${a.title} and ${b.title} overlap on ${overlaps.join('; ')}.` });
      }
    }
  }
  for (const course of courses) {
    const offered = TERMS.filter(term => course.offerings?.[term]);
    const selected = offered.filter(term => (plan[term] || []).some(item => item.id === course.id));
    if (offered.length > 1 && selected.length && selected.length < offered.length) {
      issues.push({ term: selected[0], kind: "unknown", text: `${course.title} spans ${offered.join(" + ")}; confirm entry and continuation rules for your chosen quarter.` });
    }
  }
  return issues;
}

export function reviewPlan(plan, courses, prefs) {
  const lookup = new Map(courses.map(course => [course.id, course]));
  const findings = planIssues(plan, courses, prefs.target).map(issue => ({
    ...issue,
    severity: ['clash', 'over'].includes(issue.kind) ? 'blocker' : 'check',
  }));
  const quarters = [];
  let selectedCount = 0;
  for (const term of TERMS) {
    const entries = Array.isArray(plan[term]) ? plan[term] : [];
    selectedCount += entries.length;
    const credits = entries.reduce((sum, item) => sum + (Number.isFinite(Number(item.credits)) ? Number(item.credits) : 0), 0);
    quarters.push({ term, credits, count: entries.length });
    if (!entries.length) findings.push({ term, kind: 'empty', severity: 'check', text: `${term}: no courses selected yet.` });
    else if (credits < prefs.target) findings.push({ term, kind: 'target', severity: 'check', text: `${term}: ${prefs.target - credits} credits below your planning target; add another course if you want to reach it.` });
    const seen = new Set();
    for (const entry of entries) {
      const course = lookup.get(entry.id);
      if (!course) {
        findings.push({ term, kind: 'missing', severity: 'blocker', text: `${term}: a saved course is no longer in this catalog; remove it from your draft.` });
        continue;
      }
      if (seen.has(entry.id)) findings.push({ term, kind: 'duplicate', severity: 'blocker', text: `${term}: ${course.title} appears twice.` });
      seen.add(entry.id);
      if (!course.offerings?.[term]) findings.push({ term, kind: 'unavailable', severity: 'blocker', text: `${term}: ${course.title} is not listed for this quarter.` });
      else if (/closed|cancel/i.test(course.offerings[term].status || '')) findings.push({ term, kind: 'unavailable', severity: 'blocker', text: `${term}: ${course.title} is listed as ${course.offerings[term].status.toLowerCase()}.` });
      else if (/signature/i.test(course.offerings[term].status || '')) findings.push({ term, kind: 'entry', severity: 'check', text: `${term}: ${course.title} has a signature entry status; confirm how to enroll.` });
      if (!course.standings?.includes(prefs.standing)) findings.push({ term, kind: 'standing', severity: 'blocker', text: `${term}: ${course.title} is not listed for ${prefs.standing.toLowerCase()} standing.` });
      if (!course.credits?.includes(Number(entry.credits))) findings.push({ term, kind: 'credits', severity: 'blocker', text: `${term}: ${entry.credits} credits is not a listed option for ${course.title}.` });
      const mode = course.modes?.[term];
      if (mode && Array.isArray(prefs.formats) && !prefs.formats.includes(mode)) findings.push({ term, kind: 'format', severity: 'check', text: `${term}: ${course.title} is ${mode.toLowerCase()}, outside your selected learning formats.` });
      if (prefs.location && prefs.location !== 'Any location' && course.location !== prefs.location && mode !== 'Remote') findings.push({ term, kind: 'location', severity: 'check', text: `${term}: ${course.title} is at ${course.location || 'another location'}, outside your selected campus.` });
    }
  }
  const blockers = findings.filter(item => item.severity === 'blocker');
  const checks = findings.filter(item => item.severity === 'check');
  return { quarters, selectedCount, blockers, checks, findings };
}
