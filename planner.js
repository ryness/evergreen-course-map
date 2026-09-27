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
  { id: "environment", label: "Environment & climate", test: /environment|ecolog|climate|conserv|natural resource|marine|sustainab/i },
  { id: "food", label: "Food & farming", test: /agricultur|farm|food|horticultur|garden|botany|soil/i },
  { id: "indigenous", label: "Indigenous studies", test: /native american|indigenous|tribal|coast salish|first nations/i },
  { id: "technology", label: "Technology & AI", test: /computer science|technology|\bai\b|artificial intelligence|data science|programming|digital media/i },
  { id: "business", label: "Business & nonprofits", test: /business|entrepreneur|economics|management|nonprofit|leadership|organizational/i },
  { id: "science", label: "Science & health", test: /biology|chemistry|physics|health|medicine|geology|astronomy|science/i },
  { id: "languages", label: "Language & culture", test: /language|linguistic|cultural studies|world cinema|translation|spanish|french|chinese/i },
  { id: "mathematics", label: "Math & statistics", test: /mathematics|statistics|quantitative|calculus|algebra|probabilit/i },
];

const tagCache = new WeakMap();
export function interestTags(course) {
  if (tagCache.has(course)) return tagCache.get(course);
  const core = [course.title, ...(course.fields || [])].join(" ");
  const fallback = course.description || "";
  const tags = INTERESTS.filter(item => item.test.test(core) || item.test.test(fallback)).map(item => item.id);
  tagCache.set(course, tags);
  return tags;
}

export function offeringAvailable(course, term, prefs) {
  if (!course.offerings?.[term] || !course.standings?.includes(prefs.standing)) return false;
  if (/closed|cancel/i.test(course.offerings[term].status || "")) return false;
  const mode = course.modes?.[term];
  if (mode && !prefs.formats.includes(mode)) return false;
  if (prefs.location && prefs.location !== "Any location" && course.location !== prefs.location && mode !== "Remote") return false;
  return (course.credits || []).some(n => n <= prefs.target);
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
    if (total > target) issues.push({ term, kind: "over", text: `${term}: ${total} credits exceeds your ${target}-credit target.` });
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

function score(course, term, prefs, approach) {
  const chosen = INTERESTS.filter(item => prefs.interests.includes(item.id));
  const core = (course.fields || []).join(" ");
  const common = interestTags(course).filter(tag => prefs.interests.includes(tag)).length;
  let value = chosen.reduce((n, item) => n + (item.test.test(course.title) ? 14 : item.test.test(core) ? 9 : item.test.test(course.description || "") ? 2 : 0), 0);
  value += !chosen.length && course.type === "Program" ? 2 : 0;
  const n = Math.max(...course.credits.filter(x => x <= prefs.target));
  if (approach === "depth") value += course.type === "Program" && n >= 12 ? 12 : 0;
  if (approach === "breadth") value += n <= 8 ? 8 : -8;
  if (approach === "practice") {
    const text = `${course.title} ${course.description || ""}`;
    value += /fieldwork|field trip|community|studio|workshop|practicum|internship|farm|performance|hands-on/i.test(text) ? 11 : 0;
    value += course.modes?.[term] === "In person" ? 5 : 0;
  }
  value += course.fields?.length > 3 ? 1 : 0;
  value += common ? 1 : 0;
  value -= (course.meetings?.[term] || []).length ? 0 : 2;
  value -= /conditional/i.test(course.offerings?.[term]?.status || "") ? 5 : 0;
  return value;
}

function suggestionEligible(course, prefs) {
  if (!["Course", "Program"].includes(course.type)) return false;
  if (/prior learning|pre-orientation|independent study|undergraduate research/i.test(course.title)) return false;
  if (course.prerequisites && !/^none\b|^no prerequisites/i.test(course.prerequisites)) return false;
  if (course.location && !["Olympia", "Tacoma", "Native Pathways - Olympia"].includes(course.location)) return false;
  if (prefs.location && prefs.location !== "Any location" && course.location !== prefs.location) return false;
  return true;
}

export function suggestedPaths(courses, prefs) {
  const paths = [
    { id: "depth", title: "Go deep", hint: "A substantial program with room for a smaller course" },
    { id: "breadth", title: "Explore several fields", hint: "Smaller courses across different subjects" },
    { id: "practice", title: "Learn by doing", hint: "Studios, fieldwork and community learning" },
  ];
  return paths.map(path => {
    const plan = Object.fromEntries(TERMS.map(t => [t, []]));
    const previously = new Set();
    for (const term of TERMS) {
      const candidates = courses.filter(course => suggestionEligible(course, prefs) && offeringAvailable(course, term, prefs));
      candidates.sort((a, b) => score(b, term, prefs, path.id) - score(a, term, prefs, path.id) || a.title.localeCompare(b.title));
      const selected = [];
      let remaining = prefs.target;
      while (remaining >= 2 && selected.length < 4) {
        const choices = candidates.flatMap(course => course.credits.filter(n => n <= remaining).map(credits => ({ course, credits })))
          .filter(({ course, credits }) => !selected.some(item => item.course.id === course.id)
            && !selected.some(item => courseConflict(item.course, course, term))
            && !(path.id === "breadth" && credits > 8)
            && !(previously.has(course.title.toLowerCase()) && path.id !== "depth"));
        if (!choices.length) break;
        choices.sort((a, b) => {
          const rank = item => {
            const tags = interestTags(item.course);
            const newTags = tags.filter(tag => prefs.interests.includes(tag) && !selected.some(other => interestTags(other.course).includes(tag))).length;
            const anchor = selected.length === 0 && path.id === "depth" && item.credits >= 12 ? 8 : 0;
            const fill = (item.credits / prefs.target) * (path.id === "breadth" ? 4 : 6);
            const continuity = path.id === "depth" && previously.has(item.course.title.toLowerCase()) ? 7 : 0;
            const travel = /field study|study abroad|travel|Jamaica/i.test(item.course.title) ? 20 : 0;
            return score(item.course, term, prefs, path.id) + anchor + fill + continuity + (path.id === "breadth" ? newTags * 3 : 0) - (item.credits <= 2 ? 2 : 0) - travel;
          };
          return rank(b) - rank(a) || a.course.title.localeCompare(b.course.title);
        });
        const best = choices[0];
        selected.push(best);
        remaining -= best.credits;
        previously.add(best.course.title.toLowerCase());
      }
      plan[term] = selected.map(({ course, credits }) => ({ id: course.id, credits }));
    }
    return { ...path, plan };
  });
}
