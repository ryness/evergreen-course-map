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
        if (courseConflict(a, b, term)) issues.push({ term, kind: "clash", text: `${term}: ${a.title} and ${b.title} have overlapping published meetings.` });
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
