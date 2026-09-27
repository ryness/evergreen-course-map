import { TERMS, INTERESTS, offeringAvailable, courseConflict } from './planner.js?v=20260927-final-review';

export const THEMES = [
  { id: 'core', label: 'Deep in my core academic interest', hint: 'Substantial interdisciplinary programs centered on your main subject.' },
  { id: 'breadth', label: 'A breadth of interests', hint: 'Smaller courses that let you sample several fields.' },
  { id: 'practice', label: 'Learn by doing', hint: 'Studios, fieldwork, community projects, and applied learning.' },
  { id: 'career', label: 'Explore a future career', hint: 'Coursework that connects your possible jobs to useful skills.' },
  { id: 'creative', label: 'Make, write, and perform', hint: 'Creative work across words, arts, media, music, and performance.' },
  { id: 'civic', label: 'Change my community', hint: 'Policy, justice, public service, and collective action.' },
  { id: 'inquiry', label: 'Question and investigate', hint: 'Research, evidence, critical reasoning, and big ideas.' },
  { id: 'discovery', label: 'Try unexpected connections', hint: 'Interdisciplinary discoveries beyond your usual subjects.' },
];

const stopWords = new Set('a an and are as at be become becoming class classes college course courses credit credits do for from have i in into is job jobs like my of on or the to want what with work year years'.split(' '));
const careerLinks = [
  [/lawyer|attorney|paralegal|judge/i, { law: 3, politics: 1, writing: 0.7 }],
  [/journalist|editor|author|writer|novelist|publisher/i, { writing: 3, politics: 0.7 }],
  [/teacher|educator|professor|librarian/i, { education: 3, writing: 0.7, psychology: 0.7 }],
  [/social worker|counselor|therapist|psychologist/i, { psychology: 3, law: 0.4, science: 0.4 }],
  [/doctor|physician|nurse|medical|healthcare/i, { science: 3, psychology: 0.7 }],
  [/musician|composer|performer|actor|dancer/i, { music: 3, arts: 0.7 }],
  [/designer|artist|filmmaker|photographer/i, { arts: 3, technology: 0.5 }],
  [/engineer|programmer|developer|data analyst/i, { technology: 2.5, mathematics: 2, science: 0.7 }],
  [/entrepreneur|business owner|manager/i, { business: 3, technology: 0.4 }],
  [/organizer|public servant|politician|legislator|diplomat/i, { politics: 2, law: 2, writing: 0.4 }],
  [/farmer|gardener|conservationist|ecologist/i, { food: 2, environment: 2, science: 0.5 }],
];

function normalized(text) {
  return String(text || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\bintroduction\b|\bintroductory\b/g, 'intro')
    .replace(/\bpsych\b/g, 'psychology')
    .replace(/\bstats\b/g, 'statistics')
    .replace(/\bmath\b/g, 'mathematics')
    .replace(/\bbio\b/g, 'biology')
    .replace(/\bchem\b/g, 'chemistry')
    .replace(/\biii\b/g, '3').replace(/\bii\b/g, '2').replace(/\bi\b/g, '1')
    .replace(/\bu\.?s\.?\b/g, 'us')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function words(text) {
  return normalized(text).split(/\s+/).filter(word => word && !stopWords.has(word));
}

export function courseAlreadyTaken(course, completedText) {
  const title = words(course.title);
  if (!title.length) return false;
  const titleSet = new Set(title);
  const lines = String(completedText || '').split(/[\n;]+/);
  return lines.some(line => {
    const prior = words(line.replace(/^\s*\d+\s*(?:transfer\s+)?credits?\s*(?:in|of|for)?\s*/i, ''));
    if (!prior.length) return false;
    if (prior.join(' ') === title.join(' ')) return true;
    if (prior.length < 2) return false;
    const matched = prior.filter(word => titleSet.has(word)).length;
    const prefix = prior.every((word, index) => title[index] === word);
    return prefix || (matched / prior.length >= 0.85 && matched / title.length >= 0.55);
  });
}

function profile(prefs) {
  const fields = [
    { text: prefs.academicFocus || '', weight: 3.2, name: 'focus' },
    { text: prefs.careerGoals || '', weight: 2, name: 'career' },
    { text: prefs.otherInterests || '', weight: 1.2, name: 'other' },
  ];
  const tags = new Map();
  const careerTags = new Set();
  const avoidTags = INTERESTS.filter(interest => interest.test.test(prefs.dislikedFields || '')).map(interest => interest.id);
  const avoidTokens = [...new Set(words(prefs.dislikedFields || '').filter(word => word.length > 2))].slice(0, 18);
  for (const field of fields) {
    for (const interest of INTERESTS) {
      if (interest.test.test(field.text)) tags.set(interest.id, (tags.get(interest.id) || 0) + field.weight);
    }
  }
  for (const [pattern, linked] of careerLinks) {
    if (pattern.test(prefs.careerGoals || '')) {
      for (const [tag, weight] of Object.entries(linked)) {
        tags.set(tag, (tags.get(tag) || 0) + weight);
        if (weight >= 1) careerTags.add(tag);
      }
    }
  }
  return { tags, careerTags, avoidTags, avoidTokens, fields: fields.map(field => ({ ...field, tokens: [...new Set(words(field.text).filter(word => word.length > 2))] })) };
}

function subjectFields(course) {
  return (course.fields || []).filter(field => field.length <= 38).join(' ');
}

function matchScore(course, input) {
  const title = course.title || '';
  const fields = subjectFields(course);
  const description = course.description || '';
  let score = 0;
  for (const [tag, weight] of input.tags) {
    const matcher = INTERESTS.find(item => item.id === tag)?.test;
    if (matcher) score += weight * (matcher.test(title) ? 8 : matcher.test(fields) ? 4 : matcher.test(description) ? 0.9 : 0);
  }
  const titleWords = new Set(words(title));
  const fieldWords = new Set(words(fields));
  const descWords = new Set(words(description));
  for (const field of input.fields) {
    for (const token of field.tokens.slice(0, 12)) {
      score += field.weight * (titleWords.has(token) ? 2.2 : fieldWords.has(token) ? 1.1 : descWords.has(token) ? 0.25 : 0);
    }
  }
  return score;
}

function avoidanceScore(course, input) {
  if (!input.avoidTags.length && !input.avoidTokens.length) return 0;
  const title = course.title || '';
  const fields = subjectFields(course);
  const description = course.description || '';
  let score = 0;
  for (const tag of input.avoidTags) {
    const matcher = INTERESTS.find(item => item.id === tag)?.test;
    if (matcher) score += matcher.test(title) ? 34 : matcher.test(fields) ? 20 : matcher.test(description) ? 2 : 0;
  }
  const titleWords = new Set(words(title));
  const fieldWords = new Set(words(fields));
  const descWords = new Set(words(description));
  for (const token of input.avoidTokens) {
    score += titleWords.has(token) ? 10 : fieldWords.has(token) ? 6 : descWords.has(token) ? 0.6 : 0;
  }
  return Math.min(score, 100);
}

export function courseRelevance(course, prefs) {
  const input = profile(prefs);
  return matchScore(course, input) - avoidanceScore(course, input);
}

function primaryTags(course) {
  const core = course.title + ' ' + subjectFields(course);
  return INTERESTS.filter(item => item.test.test(core)).map(item => item.id);
}

function fitsTheme(course, themeId) {
  const title = course.title || '';
  const details = title + ' ' + (course.description || '');
  const tags = primaryTags(course);
  if (themeId === 'creative') return tags.some(tag => ['writing','arts','music','languages'].includes(tag)) || /creative|studio|composition|story|performance|film|poetry|making|printmak|ceramic/i.test(title);
  if (themeId === 'civic') return tags.some(tag => ['law','politics','indigenous','environment'].includes(tag)) || /community|policy|justice|democra|collective|public service/i.test(title);
  if (themeId === 'inquiry') return tags.some(tag => ['science','mathematics','psychology'].includes(tag)) || /research|evidence|reason|method|statistics|philosophy|science|inquir|critical/i.test(title);
  if (themeId === 'practice') return /fieldwork|field trip|community|studio|workshop|practicum|internship|farm|performance|hands.on|lab\b|making|design/i.test(details);
  return true;
}

function themeBonus(course, term, themeId, credits, selected, previousTitles, input) {
  const title = course.title || '';
  const details = title + ' ' + (course.description || '');
  const tags = primaryTags(course);
  const seen = new Set(selected.flatMap(item => primaryTags(item.course)));
  let bonus = 0;
  if (themeId === 'core') bonus += course.type === 'Program' && credits >= 12 ? 32 : 0;
  if (themeId === 'breadth') bonus += credits <= 8 ? 25 : -30;
  if (themeId === 'breadth') bonus += tags.filter(tag => !seen.has(tag)).length * 5;
  if (themeId === 'practice') bonus += /fieldwork|field trip|community|studio|workshop|practicum|internship|farm|performance|hands.on|lab\b/i.test(details) ? 35 : -12;
  if (themeId === 'practice' && course.modes?.[term] === 'In person') bonus += 4;
  if (themeId === 'career') bonus += /internship|practicum|career|professional|public service|policy|portfolio/i.test(title) ? 30 : 0;
  if (themeId === 'career') bonus += tags.some(tag => input.careerTags.has(tag)) ? 25 : input.careerTags.size ? -10 : 0;
  if (themeId === 'career') bonus += input.fields[1].tokens.some(token => normalized(title).includes(token)) ? 12 : 0;
  if (themeId === 'creative') bonus += tags.some(tag => ['writing', 'arts', 'music', 'languages'].includes(tag)) ? 34 : -15;
  if (themeId === 'creative') bonus += /creative|studio|composition|story|performance|film|poetry|making/i.test(title) ? 10 : 0;
  if (themeId === 'civic') bonus += /community|policy|justice|law|democra|civic|politic|public service|social movement/i.test(title) ? 39 : -12;
  if (themeId === 'civic') bonus += tags.some(tag => ['law', 'politics', 'indigenous', 'environment'].includes(tag)) ? 7 : 0;
  if (themeId === 'inquiry') bonus += /research|evidence|reason|method|statistics|philosophy|science|inquir|critical/i.test(title) ? 40 : -12;
  if (themeId === 'inquiry') bonus += tags.some(tag => ['science', 'mathematics', 'psychology'].includes(tag)) ? 7 : 0;
  if (themeId === 'discovery') bonus += Math.min((course.fields || []).length, 5) * 5 + tags.filter(tag => !seen.has(tag)).length * 8;
  if (themeId === 'discovery' && credits <= 8) bonus += 10;
  if (themeId === 'discovery') bonus -= matchScore(course, input) * 0.35;
  if (themeId === 'core' && previousTitles.has(title.toLowerCase())) bonus += 12;
  if (themeId !== 'core' && previousTitles.has(title.toLowerCase())) bonus -= 100;
  if (/field study|study abroad|travel|Jamaica/i.test(title)) bonus -= 45;
  if (/conditional/i.test(course.offerings?.[term]?.status || '')) bonus -= 8;
  if (!(course.meetings?.[term] || []).length) bonus -= 3;
  return bonus;
}

function suggestionEligible(course, prefs) {
  if (!['Course', 'Program'].includes(course.type)) return false;
  if (prefs.excludedCourseIds?.includes(course.id)) return false;
  if (/prior learning|pre-orientation|independent study|undergraduate research|study abroad|^TRIO\b|^ECE Lyceum|^Lyceum:/i.test(course.title)) return false;
  if (course.prerequisites && !/^(none\b|no prerequisites)/i.test(course.prerequisites)) return false;
  if (prefs.location && prefs.location !== 'Any location' && course.location !== prefs.location) return false;
  return !courseAlreadyTaken(course, prefs.completedCourses);
}

function suggestQuarter(courses, prefs, term, themeId, initial = [], previousTitles = new Set(), avoidIds = new Set(), options = {}) {
  const lookup = new Map(courses.map(course => [course.id, course]));
  const input = profile(prefs);
  const pool = courses.filter(course => suggestionEligible(course, prefs) && offeringAvailable(course, term, prefs));
  const selected = initial.map(item => ({ ...item, course: lookup.get(item.id) })).filter(item => item.course);
  const seenTitles = new Set(previousTitles);
  for (const item of selected) seenTitles.add(item.course.title.toLowerCase());
  let remaining = prefs.target - initial.reduce((sum, item) => sum + Number(item.credits), 0);
  let added = 0;
  while (remaining >= 2 && selected.length < (options.maxCourses || 6)) {
    let best = null;
    const preferredCredits = Math.min(remaining, options.creditTargets?.[Math.min(added, options.creditTargets.length - 1)] ?? remaining);
    const selectedTags = new Set(selected.flatMap(item => primaryTags(item.course)));
    for (const course of pool) {
      if (selected.some(item => item.course.id === course.id)) continue;
      if (options.excludeAvoided && avoidIds.has(course.id)) continue;
      if (themeId !== 'core' && seenTitles.has(course.title.toLowerCase())) continue;
      if (!fitsTheme(course, themeId)) continue;
      if (selected.some(item => courseConflict(item.course, course, term))) continue;
      for (const credits of course.credits.filter(n => n <= remaining)) {
        if (options.maxCredits && credits > options.maxCredits) continue;
        if (themeId === 'breadth' && credits > 8) continue;
        const core = matchScore(course, input);
        const focusWeight = ({ core: 0.5, breadth: 0.18, practice: 0.2, career: 0.3, creative: 0.2, civic: 0.22, inquiry: 0.18, discovery: 0.1 })[themeId];
        const score = core * focusWeight - avoidanceScore(course, input) + themeBonus(course, term, themeId, credits, selected, seenTitles, input)
          + credits / prefs.target * (themeId === 'breadth' ? 4 : 7)
          + (selected.length === 0 && themeId === 'core' && credits >= 12 ? 8 : 0)
          - (credits <= 2 ? 3 : 0)
          - (options.creditTargets ? Math.abs(credits - preferredCredits) * 25 : 0)
          - (avoidIds.has(course.id) ? 110 : 0)
          + (options.diversityBonus || 0) * primaryTags(course).filter(tag => !selectedTags.has(tag)).length;
        if (!best || score > best.score || (score === best.score && course.title.localeCompare(best.course.title) < 0)) best = { course, credits, score };
      }
    }
    if (!best) break;
    selected.push(best);
    remaining -= best.credits;
    added++;
    if (themeId !== 'core' || (best.course.type === 'Program' && best.credits >= 12)) seenTitles.add(best.course.title.toLowerCase());
  }
  const knownIds = new Set(selected.map(item => item.course.id));
  const missingPinned = initial.filter(item => item.pinned && !knownIds.has(item.id));
  return [...missingPinned, ...selected.map(item => item.pinned
    ? { id: item.course.id, credits: item.credits, pinned: true }
    : { id: item.course.id, credits: item.credits })];
}

export function suggestThemePlan(courses, prefs, themeId, existingPlan = {}) {
  const plan = Object.fromEntries(TERMS.map(term => [term, (existingPlan[term] || []).filter(item => item.pinned)]));
  if (!THEMES.some(theme => theme.id === themeId)) return plan;
  const lookup = new Map(courses.map(course => [course.id, course]));
  const previousTitles = new Set();
  for (const term of TERMS) {
    plan[term] = suggestQuarter(courses, prefs, term, themeId, plan[term], previousTitles);
    for (const item of plan[term]) {
      const course = lookup.get(item.id);
      if (course && (themeId !== 'core' || (course.type === 'Program' && item.credits >= 12))) previousTitles.add(course.title.toLowerCase());
    }
  }
  return plan;
}

export function spinQuarterPlan(courses, prefs, plan, term, themeId = 'core', spinIndex = 0) {
  const current = plan[term] || [];
  const pinned = current.filter(item => item.pinned);
  const previous = new Set(current.filter(item => !item.pinned).map(item => item.id));
  const lookup = new Map(courses.map(course => [course.id, course]));
  const otherTitles = new Set(TERMS.filter(other => other !== term)
    .flatMap(other => (plan[other] || []).map(item => lookup.get(item.id)?.title.toLowerCase()).filter(Boolean)));
  const theme = THEMES.some(item => item.id === themeId) ? themeId : 'core';
  const gap = Math.max(0, prefs.target - pinned.reduce((sum, item) => sum + Number(item.credits), 0));
  const shapes = [
    { maxCredits: Math.max(4, Math.ceil(gap / 2)), creditTargets: [Math.ceil(gap / 2)] },
    { maxCredits: Math.max(4, Math.min(8, gap)), creditTargets: [4, 8, 4], diversityBonus: 6 },
    { maxCredits: Math.min(4, gap), creditTargets: [4], diversityBonus: 4 },
    { maxCredits: Math.max(4, gap - 4), creditTargets: [gap - 4, 4] },
    { maxCredits: gap, creditTargets: [gap] },
  ];
  const shape = { ...shapes[Math.abs(spinIndex) % shapes.length], maxCourses: 8 };
  const total = items => items.reduce((sum, item) => sum + Number(item.credits), 0);
  let spun = suggestQuarter(courses, prefs, term, theme, pinned, otherTitles, previous, shape);
  if (total(spun) < prefs.target) spun = suggestQuarter(courses, prefs, term, theme, spun, otherTitles, new Set(), shape);
  if (total(spun) < prefs.target) spun = suggestQuarter(courses, prefs, term, theme, spun, otherTitles, previous, { maxCourses: 8, excludeAvoided: true });
  if (total(spun) < prefs.target) spun = suggestQuarter(courses, prefs, term, theme, spun, otherTitles, new Set(), { maxCourses: 8 });
  return spun;
}

export function replacementSuggestions(courses, prefs, plan, term, removed, themeId = 'custom', limit = 8) {
  const lookup = new Map(courses.map(course => [course.id, course]));
  const selected = (plan[term] || []).map(item => lookup.get(item.id)).filter(Boolean);
  const total = (plan[term] || []).reduce((sum, item) => sum + Number(item.credits), 0);
  const room = Math.max(0, prefs.target - total);
  const input = profile(prefs);
  const hasGoals = Boolean(prefs.academicFocus?.trim() || prefs.careerGoals?.trim() || prefs.otherInterests?.trim());
  const removedCourse = lookup.get(removed?.id);
  const removedTags = removedCourse ? primaryTags(removedCourse) : [];
  const ranked = courses.filter(course => suggestionEligible(course, prefs) && offeringAvailable(course, term, prefs)
      && course.id !== removed?.id && !selected.some(item => item.id === course.id)
      && !selected.some(item => courseConflict(item, course, term)))
    .map(course => {
      const creditDistance = n => Math.abs(n - room) + (n > room ? 4 : 0);
      const options = [...course.credits].sort((a, b) => creditDistance(a) - creditDistance(b) || b - a);
      const credits = options[0];
      const distance = creditDistance(credits);
      const overlap = primaryTags(course).filter(tag => removedTags.includes(tag)).length;
      const interestScore = matchScore(course, input) - avoidanceScore(course, input);
      const pertinent = interestScore >= 8 || (!hasGoals && interestScore >= 0);
      const fitBand = distance <= 4 ? 0 : distance <= 8 ? 1 : 2;
      const tier = fitBand === 2 ? 3 : fitBand === 0 && pertinent ? 0 : fitBand === 0 || pertinent ? 1 : 2;
      const score = interestScore * 0.4 + themeBonus(course, term, themeId, credits, [], new Set(), input) * 0.2
        + overlap * 5 - distance * 8;
      const gap = Math.abs(room - credits);
      const fitText = credits === room ? `Fills ${room}-credit gap` : `${gap} ${gap === 1 ? 'credit' : 'credits'} ${credits < room ? 'below' : 'above'} target`;
      const reason = `${hasGoals && pertinent ? 'Matches your interests' : overlap ? 'Related subject' : 'Another option'} · ${fitText}`;
      return { course, credits, tier, score, reason };
    });
  ranked.sort((a, b) => a.tier - b.tier || b.score - a.score || a.course.title.localeCompare(b.course.title));
  return ranked.slice(0, limit);
}
