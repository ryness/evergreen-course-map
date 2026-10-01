import { TERMS, STANDINGS, FORMATS, INTERESTS, ILC_ID, ilcOffering, compactMeetingTimes, offeringAvailable, reviewPlan, capturePlan, draftFromSaved, savedCredits, validSavedPlan } from './planner.js?v=20261001-ilc';
import { THEMES, courseRelevance, courseAlreadyTaken, suggestThemePlan, spinQuarterPlan, replacementSuggestions } from './recommend.js?v=20261001-ilc';

const COOKIE = 'evergreen-course-map-v1';
const EXCLUDED_COOKIE = 'evergreen-course-map-excluded-v1';
const SAVED_PLANS_KEY = 'evergreen-course-map-named-plans-v1';
const $ = id => document.getElementById(id);
const emptyPlan = () => Object.fromEntries(TERMS.map(term => [term, []]));
const defaults = { academicYear: '', standing: 'Freshman', target: 16, location: 'Any location', careerGoals: '', academicFocus: '', otherInterests: '', dislikedFields: '', completedCourses: '', formats: [...FORMATS] };
const state = { prefs: { ...defaults }, plans: {}, themes: {}, spins: {}, excluded: {}, savedPlans: [], savedPlansAvailable: true, compare: [], replacement: null, term: 'Fall', query: '', creditFilter: 0, sort: 'relevance', visible: 18, data: null, manifest: null };
const ILC = ilcOffering();
let toastTimer, goalsTimer, suggestionsTimer;

function readCookie() {
  const row = document.cookie.split('; ').find(x => x.startsWith(`${COOKIE}=`));
  if (!row) return;
  try {
    const data = JSON.parse(decodeURIComponent(row.slice(COOKIE.length + 1)));
    const prefs = data.prefs || {};
    state.prefs = {
      academicYear: typeof prefs.academicYear === 'string' ? prefs.academicYear : '',
      standing: STANDINGS.includes(prefs.standing) ? prefs.standing : defaults.standing,
      target: [4, 8, 12, 16, 20].includes(Number(prefs.target)) ? Number(prefs.target) : defaults.target,
      location: ['Any location', 'Olympia', 'Tacoma', 'Native Pathways - Olympia'].includes(prefs.location) ? prefs.location : defaults.location,
      careerGoals: typeof prefs.careerGoals === 'string' ? prefs.careerGoals.slice(0, 300) : '',
      academicFocus: typeof prefs.academicFocus === 'string' ? prefs.academicFocus.slice(0, 300) : (Array.isArray(prefs.interests) ? prefs.interests.map(id => INTERESTS.find(item => item.id === id)?.label).filter(Boolean).join(', ') : ''),
      otherInterests: typeof prefs.otherInterests === 'string' ? prefs.otherInterests.slice(0, 300) : '',
      dislikedFields: typeof prefs.dislikedFields === 'string' ? prefs.dislikedFields.slice(0, 300) : '',
      completedCourses: typeof prefs.completedCourses === 'string' ? prefs.completedCourses.slice(0, 450) : '',
      formats: Array.isArray(prefs.formats) && prefs.formats.length ? prefs.formats.filter(x => FORMATS.includes(x)) : [...FORMATS],
    };
    if (data.plans && typeof data.plans === 'object') state.plans = data.plans;
    if (data.themes && typeof data.themes === 'object') state.themes = data.themes;
    if (data.spins && typeof data.spins === 'object') for (const [year, counts] of Object.entries(data.spins)) {
      if (counts && typeof counts === 'object') state.spins[year] = Object.fromEntries(TERMS.map(term =>
        [term, Number.isSafeInteger(counts[term]) && counts[term] >= 0 ? counts[term] : 0]));
    }
    if (Array.isArray(data.compare)) state.compare = data.compare.filter(item => item && typeof item.id === 'string' && TERMS.includes(item.term)).slice(0, 3);
    if (Number.isInteger(data.creditFilter) && data.creditFilter > 0) state.creditFilter = data.creditFilter;
  } catch { /* An old or malformed cookie should not stop the planner. */ }
}

function readExcludedCookie() {
  const row = document.cookie.split('; ').find(x => x.startsWith(`${EXCLUDED_COOKIE}=`));
  if (!row) return;
  try {
    const data = JSON.parse(decodeURIComponent(row.slice(EXCLUDED_COOKIE.length + 1)));
    if (data && typeof data === 'object') for (const [year, ids] of Object.entries(data)) {
      if (Array.isArray(ids)) state.excluded[year] = [...new Set(ids.filter(id => typeof id === 'string'))];
    }
  } catch { /* Ignore a malformed exclusions cookie. */ }
}

function readSavedPlans() {
  let raw;
  try { raw = localStorage.getItem(SAVED_PLANS_KEY); }
  catch { state.savedPlansAvailable = false; return; }
  try {
    const parsed = JSON.parse(raw || '[]');
    state.savedPlans = Array.isArray(parsed) ? parsed.filter(validSavedPlan) : [];
  } catch { state.savedPlans = []; }
}

function persistSavedPlans(plans) {
  try {
    localStorage.setItem(SAVED_PLANS_KEY, JSON.stringify(plans));
    state.savedPlans = plans;
    renderSavedPlans();
    return true;
  } catch {
    notify('This browser could not save named plans. Check its storage settings or available space.');
    return false;
  }
}

function save() {
  const value = encodeURIComponent(JSON.stringify({ prefs: state.prefs, plans: state.plans, themes: state.themes, spins: state.spins, compare: state.compare, creditFilter: state.creditFilter }));
  const excludedValue = encodeURIComponent(JSON.stringify(state.excluded));
  const path = location.pathname.replace(/[^/]*$/, '') || '/';
  document.cookie = `${COOKIE}=${value}; Max-Age=31536000; Path=${path}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  document.cookie = `${EXCLUDED_COOKIE}=${excludedValue}; Max-Age=31536000; Path=${path}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function notify(message) {
  const toast = $('toast'); toast.textContent = message; toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function catalog() { return state.data ? [ILC, ...state.data.courses] : []; }
function byId() { return new Map(catalog().map(course => [course.id, course])); }
function currentPlan() { return state.plans[state.prefs.academicYear] || emptyPlan(); }
function isPinned(id, term) { return (currentPlan()[term] || []).some(item => item.id === id && item.pinned); }
function isPinnedAnywhere(id) { return TERMS.some(term => isPinned(id, term)); }
function pinControl(course, term, pinned, className = 'choice-pin') {
  return `<button class="${className}${pinned ? ' choice-locked' : ''}" type="button" data-pin-id="${escapeHtml(course.id)}" data-pin-term="${term}" aria-pressed="${pinned}" title="${pinned ? 'Tap to remove from Yes for me' : 'Keep this course through new spins'}">${pinned ? '✓ ' : ''}Yes for me</button>`;
}
function excludedIds() { return state.excluded[state.prefs.academicYear] || []; }
function recommendationPrefs() { return { ...state.prefs, excludedCourseIds: excludedIds() }; }
function planCount() { return TERMS.reduce((n, term) => n + (currentPlan()[term] || []).length, 0); }
function plannedIds(term) { return new Set((currentPlan()[term] || []).map(item => item.id)); }

function currentSnapshot(name) {
  return capturePlan({
    id: crypto.randomUUID(), name, academicYear: state.prefs.academicYear,
    savedAt: new Date().toISOString(), prefs: state.prefs, plan: currentPlan(), courses: catalog(),
  });
}

function renderSavedPlans() {
  const list = $('saved-plans-list');
  if (!state.savedPlansAvailable) {
    list.innerHTML = '<p class="saved-plans-empty">This browser is not allowing local plan storage. Printing the current draft is still available.</p>';
    $('plan-name').disabled = true;
    $('save-plan-form').querySelector('[type="submit"]').disabled = true;
    return;
  }
  list.innerHTML = state.savedPlans.length ? state.savedPlans.map(snapshot => {
    const date = new Date(snapshot.savedAt);
    const saved = Number.isNaN(date.getTime()) ? 'Saved plan' : `Saved ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    const quarters = TERMS.map(term => `${term} ${savedCredits(snapshot, term)} cr`).join(' · ');
    return `<article class="saved-plan-card"><h3>${escapeHtml(snapshot.name)}</h3><p class="saved-plan-facts">${escapeHtml(snapshot.academicYear)} · ${escapeHtml(saved)}</p><p class="saved-plan-quarters">${escapeHtml(quarters)}</p><div class="saved-plan-actions"><button class="button-secondary" type="button" data-open-saved="${escapeHtml(snapshot.id)}">Open in My year</button><button class="button-secondary" type="button" data-print-saved="${escapeHtml(snapshot.id)}">Print / Save PDF</button><button class="text-button saved-plan-remove" type="button" data-remove-saved="${escapeHtml(snapshot.id)}">Remove</button></div></article>`;
  }).join('') : '<p class="saved-plans-empty">No named plans yet. Build a draft in My year, then save it here to compare options.</p>';
}

function printPlan(snapshot) {
  const date = new Date(snapshot.savedAt);
  const dateText = Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  const total = TERMS.reduce((sum, term) => sum + savedCredits(snapshot, term), 0);
  const quarters = TERMS.map(term => `<section class="print-quarter"><h2>${term}<span>${savedCredits(snapshot, term)} credits</span></h2>${snapshot.terms[term].length ? snapshot.terms[term].map(entry => {
    const title = /^https:\/\/www\.evergreen\.edu\//.test(entry.url || '')
      ? `<a class="print-course-title" href="${escapeHtml(entry.url)}">${escapeHtml(entry.title)}</a>`
      : `<strong class="print-course-title">${escapeHtml(entry.title)}</strong>`;
    return `<div class="print-course">${title}<div class="print-course-meta">${entry.credits} cr · ${escapeHtml(entry.mode)}</div><div class="print-course-times">${escapeHtml(entry.meetingTimes)}</div>${entry.pinned ? '<div class="print-course-pin">✓ Yes for me</div>' : ''}</div>`;
  }).join('') : '<p class="print-quarter-empty">No courses selected</p>'}</section>`).join('');
  $('print-sheet').innerHTML = `<div class="print-header"><div class="print-brand">✳ Evergreen Course Mapper</div><h1>${escapeHtml(snapshot.name)}</h1><div class="print-subtitle">${escapeHtml(snapshot.academicYear)} · ${total} planned credits · ${escapeHtml(snapshot.prefs.standing || '')}${snapshot.prefs.target ? ` · ${escapeHtml(snapshot.prefs.target)} cr/quarter target` : ''}${dateText ? ` · ${escapeHtml(dateText)}` : ''}</div></div><div class="print-quarters">${quarters}</div><div class="print-footer">Planning copy. Meeting times, credits, and availability can change; check each linked official Evergreen listing before enrolling.</div>`;
  const oldTitle = document.title;
  document.title = `${snapshot.name} — Evergreen Course Mapper`;
  try { window.print(); }
  finally { document.title = oldTitle; }
}

async function openSavedPlan(snapshot) {
  if (!state.manifest) { notify('Wait for the catalog to load before opening a plan.'); return; }
  if (!state.manifest.catalogs.some(item => item.academicYear === snapshot.academicYear)) {
    notify('That catalog year is no longer available to open. You can still print the saved plan.');
    return;
  }
  const draft = draftFromSaved(snapshot);
  const existing = state.plans[snapshot.academicYear] || emptyPlan();
  const hasExisting = TERMS.some(term => (existing[term] || []).length);
  if (hasExisting && JSON.stringify(existing) !== JSON.stringify(draft)
    && !window.confirm(`Opening this saved plan replaces your ${snapshot.academicYear} draft and restores its goals. Save the draft first if you want to keep it. Continue?`)) return;
  const p = snapshot.prefs;
  state.prefs = {
    academicYear: snapshot.academicYear,
    standing: STANDINGS.includes(p.standing) ? p.standing : defaults.standing,
    target: [4, 8, 12, 16, 20].includes(Number(p.target)) ? Number(p.target) : defaults.target,
    location: ['Any location', 'Olympia', 'Tacoma', 'Native Pathways - Olympia'].includes(p.location) ? p.location : defaults.location,
    careerGoals: typeof p.careerGoals === 'string' ? p.careerGoals.slice(0, 300) : '',
    academicFocus: typeof p.academicFocus === 'string' ? p.academicFocus.slice(0, 300) : '',
    otherInterests: typeof p.otherInterests === 'string' ? p.otherInterests.slice(0, 300) : '',
    dislikedFields: typeof p.dislikedFields === 'string' ? p.dislikedFields.slice(0, 300) : '',
    completedCourses: typeof p.completedCourses === 'string' ? p.completedCourses.slice(0, 450) : '',
    formats: Array.isArray(p.formats) && p.formats.some(mode => FORMATS.includes(mode))
      ? p.formats.filter(mode => FORMATS.includes(mode)) : [...FORMATS],
  };
  state.plans[snapshot.academicYear] = draft;
  state.themes[snapshot.academicYear] = 'custom';
  state.replacement = null;
  state.term = 'Fall';
  state.query = ''; $('search').value = '';
  syncGoalInputs();
  save();
  if (state.data?.academicYear === snapshot.academicYear) render();
  else await loadYear(snapshot.academicYear);
  const missing = TERMS.reduce((count, term) => count + draft[term].filter(entry => !byId().has(entry.id)).length, 0);
  notify(missing ? `Plan opened. ${missing} course${missing === 1 ? '' : 's'} no longer in the catalog; check Final review.` : `Opened ${snapshot.name} in My year.`);
  $('plan').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function togglePinCourse(id, term, credits) {
  const course = byId().get(id);
  if (!course || !TERMS.includes(term)) return;
  const plan = currentPlan();
  const existing = (plan[term] || []).find(item => item.id === id);
  if (existing?.pinned) {
    delete existing.pinned;
    save(); render();
    notify(`${course.title} is no longer marked Yes for me in ${term}. It remains in your draft.`);
    return;
  }
  if (!course.credits.includes(credits)) return;
  if (existing) existing.pinned = true;
  else plan[term].push({ id, credits, pinned: true });
  const theme = state.themes[state.prefs.academicYear];
  if (theme && theme !== 'custom') state.plans[state.prefs.academicYear] = suggestThemePlan(catalog(), recommendationPrefs(), theme, plan);
  state.replacement = null;
  save(); render();
  notify(`${course.title} is saved as Yes for me in ${term}.`);
}
function matchingCourses() {
  const excluded = new Set(excludedIds());
  const planned = plannedIds(state.term);
  return catalog().filter(course => !excluded.has(course.id) && !planned.has(course.id) && offeringAvailable(course, state.term, state.prefs))
    .filter(course => !state.creditFilter || course.credits.includes(state.creditFilter))
    .filter(course => !state.query || `${course.title} ${course.description} ${(course.fields || []).join(' ')}`.toLowerCase().includes(state.query));
}
function relevance(course) {
  return courseRelevance(course, state.prefs)
    + (course.type === 'Program' ? 1 : 0)
    + ((course.meetings?.[state.term] || []).length ? 1 : 0)
    - (courseAlreadyTaken(course, state.prefs.completedCourses) ? 25 : 0);
}
function timeText(minute) {
  const hour = Math.floor(minute / 60); return `${hour % 12 || 12}:${String(minute % 60).padStart(2, '0')}${hour >= 12 ? 'pm' : 'am'}`;
}
function scheduleText(course, term) {
  const meetings = course.meetings?.[term] || [];
  if (!meetings.length) return '';
  const unique = [...new Set(meetings.map(m => `${m.day} ${timeText(m.start)}–${timeText(m.end)}`))];
  return unique.slice(0, 2).join(' · ') + (unique.length > 2 ? ` +${unique.length - 2} more` : '');
}

function renderControls() {
  const p = state.prefs;
  $('academic-year').innerHTML = state.manifest.catalogs.map(item => `<option value="${escapeHtml(item.academicYear)}">${escapeHtml(item.academicYear)}</option>`).join('');
  $('academic-year').value = p.academicYear;
  $('standing').value = p.standing; $('target').value = String(p.target); $('location').value = p.location;
  $('formats').innerHTML = FORMATS.map(mode => `<button class="chip" type="button" data-format="${escapeHtml(mode)}" aria-pressed="${p.formats.includes(mode)}">${escapeHtml(mode)}</button>`).join('');
  $('browse-terms').innerHTML = TERMS.map(term => `<button type="button" data-term="${term}" aria-pressed="${state.term === term}">${term}</button>`).join('');
  const creditValues = [...new Set(catalog().flatMap(course => course.credits))].sort((a, b) => a - b);
  if (!creditValues.includes(state.creditFilter)) state.creditFilter = 0;
  $('credit-filter').innerHTML = '<option value="0">Any credits</option>' + creditValues.map(n => `<option value="${n}">${n} credits</option>`).join('');
  $('credit-filter').value = String(state.creditFilter);
  $('data-note').textContent = `${state.data.courses.length} undergraduate offerings + an ILC planner option · ${state.prefs.academicYear} · refreshed ${new Date(state.data.updatedAt).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'})} from Evergreen’s catalog`;
}

function syncGoalInputs() {
  $('career-goals').value = state.prefs.careerGoals;
  $('academic-focus').value = state.prefs.academicFocus;
  $('other-interests').value = state.prefs.otherInterests;
  $('disliked-fields').value = state.prefs.dislikedFields;
  $('completed-courses').value = state.prefs.completedCourses;
}

function renderCompare() {
  const lookup = byId();
  state.compare = state.compare.filter(item => lookup.has(item.id) && lookup.get(item.id).offerings?.[item.term]);
  $('compare').hidden = !state.compare.length;
  $('compare-grid').innerHTML = state.compare.map(item => {
    const course = lookup.get(item.id);
    const schedule = scheduleText(course, item.term) || 'Check official schedule';
    const fields = (course.fields || []).slice(0, 3).join(' · ');
    const pinned = isPinned(item.id, item.term);
    const choices = `<div class="compare-choices">${pinControl(course, item.term, pinned)}${isPinnedAnywhere(item.id) ? '' : `<button type="button" data-exclude="${escapeHtml(course.id)}" aria-label="Exclude ${escapeHtml(course.title)} from suggestions">Not for me</button>`}</div>`;
    return `<article class="compare-card"><div class="compare-card-head"><span class="pill gold">${item.term}</span><button type="button" data-uncompare="${escapeHtml(item.id)}" data-uncompare-term="${item.term}" aria-label="Remove ${escapeHtml(course.title)} from comparison">×</button></div><h4>${escapeHtml(course.title)}</h4><div class="compare-facts"><div><span>Credits</span><strong>${escapeHtml(course.credits.join(' or '))}</strong></div><div><span>Format</span><strong>${escapeHtml(course.modes?.[item.term] || 'TBA')}</strong></div><div><span>Location</span><strong>${escapeHtml(course.location || 'See listing')}</strong></div><div><span>Meeting</span><strong>${escapeHtml(schedule)}</strong></div></div><p class="compare-fields">${escapeHtml(fields)}</p><p class="compare-desc">${escapeHtml((course.description || '').slice(0, 420) || 'Read the official listing for course details.')}${(course.description || '').length > 420 ? '…' : ''}</p>${course.prerequisites && !/^none\b|^no prerequisites/i.test(course.prerequisites) ? '<p class="compare-caution">Entry requirements: check the official listing.</p>' : ''}<div class="compare-end"><a href="${escapeHtml(course.url)}" target="_blank" rel="noopener">Read official listing ↗</a>${choices}</div></article>`;
  }).join('') + (state.compare.length < 2 ? '<div class="compare-placeholder">Choose another course to compare it here.</div>' : '');
}

function renderCourses() {
  let results = matchingCourses();
  if (state.sort === 'title') results.sort((a,b) => a.title.localeCompare(b.title));
  else if (state.sort === 'credits') results.sort((a,b) => Math.max(...b.credits) - Math.max(...a.credits) || a.title.localeCompare(b.title));
  else results.sort((a,b) => Number(Boolean(b.isIlc)) - Number(Boolean(a.isIlc)) || relevance(b) - relevance(a) || a.title.localeCompare(b.title));
  const hasGoals = Boolean(state.prefs.careerGoals || state.prefs.academicFocus || state.prefs.otherInterests || state.prefs.dislikedFields);
  const plannedCount = plannedIds(state.term).size;
  $('result-count').textContent = `${results.length} ${results.length === 1 ? 'offering' : 'offerings'} for ${state.term.toLowerCase()}${state.creditFilter ? ` · offering ${state.creditFilter} credits` : ''}${hasGoals && state.sort === 'relevance' ? ' · ranked by your goals' : ''}${plannedCount ? ` · ${plannedCount} already in your ${state.term.toLowerCase()} plan` : ''}`;
  const shown = results.slice(0, state.visible);
  $('course-list').innerHTML = shown.length ? shown.map(course => {
    const pinned = isPinned(course.id, state.term);
    const comparing = state.compare.some(item => item.id === course.id && item.term === state.term);
    const availableCredits = course.credits;
    const quarterCredits = (currentPlan()[state.term] || []).reduce((sum, item) => sum + Number(item.credits), 0);
    const desiredCredits = course.isIlc ? Math.max(2, state.prefs.target - quarterCredits) : state.prefs.target;
    const preferred = state.creditFilter && availableCredits.includes(state.creditFilter) ? state.creditFilter : availableCredits.filter(n => n <= desiredCredits).at(-1) ?? availableCredits[0];
    const alreadyTaken = courseAlreadyTaken(course, state.prefs.completedCourses);
    const mode = course.isIlc ? 'Independent study' : course.modes?.[state.term] || 'Format TBA';
    const schedule = scheduleText(course, state.term);
    const location = course.location && course.location !== 'Olympia' ? course.location : '';
    const offeredTerms = TERMS.filter(term => offeringAvailable(course, term, state.prefs));
    const otherTerms = offeredTerms.filter(term => term !== state.term);
    const status = course.offerings?.[state.term]?.status || '';
    const choices = `<div class="course-choice-actions">${pinControl(course, state.term, pinned)}${isPinnedAnywhere(course.id) ? '' : `<button class="exclude-button" type="button" data-exclude="${escapeHtml(course.id)}" aria-label="Exclude ${escapeHtml(course.title)} from suggestions">Not for me</button>`}</div>`;
    return `<article class="course-card${course.isIlc ? ' ilc-card' : ''}" data-course="${escapeHtml(course.id)}"><div class="course-top"><a class="course-title" href="${escapeHtml(course.url)}" target="_blank" rel="noopener">${escapeHtml(course.title)} ↗</a>${choices}</div><div class="course-meta"><span class="pill gold">${escapeHtml(course.type)}</span><span class="pill">${escapeHtml(mode)}</span><span class="pill neutral">${course.isIlc ? '2–16' : escapeHtml(course.credits.join(' or '))} cr</span>${alreadyTaken ? '<span class="pill taken">Listed as already taken</span>' : ''}${location ? `<span class="pill neutral">${escapeHtml(location)}</span>` : ''}${otherTerms.length ? `<span class="pill neutral">Also ${escapeHtml(otherTerms.join(' + '))}</span>` : ''}${status === 'Conditional' ? '<span class="pill gold">Conditional entry</span>' : ''}${course.prerequisites && !/^none\b|^no prerequisites/i.test(course.prerequisites) ? '<span class="pill gold">Entry requirements</span>' : ''}</div><p class="course-desc">${escapeHtml(course.description || (course.fields || []).join(' · ') || 'Read the official catalog entry for course details.')}</p>${course.isIlc ? '<p class="course-extra">Schedule arranged with sponsor · Subject to approval</p>' : schedule ? `<p class="course-extra">Meets ${escapeHtml(schedule)}${course.timeOffered ? ` · ${escapeHtml(course.timeOffered)}` : ''}</p>` : '<p class="course-extra">Meeting times: see official schedule</p>'}<div class="course-actions"><div class="course-links"><a href="${escapeHtml(course.scheduleUrl || course.url)}" target="_blank" rel="noopener">${course.isIlc ? 'ILC requirements' : course.scheduleUrl ? 'Full schedule' : 'Catalog details'} ↗</a><button class="compare-button" type="button" data-compare="${course.id}">${comparing ? 'Remove comparison' : 'Compare'}</button></div><div class="credit-picker"><label for="credits-${course.id}">Credits</label><select id="credits-${course.id}" data-credit-for="${course.id}">${availableCredits.map(n => `<option value="${n}" ${n === preferred ? 'selected' : ''}>${n}</option>`).join('')}</select><button class="add-button" type="button" data-add="${course.id}">Add to ${state.term}</button></div></div>${otherTerms.length && !course.isIlc ? `<button type="button" class="add-all" data-add-all="${course.id}">Add ${escapeHtml(offeredTerms.join(' + '))}</button>` : ''}</article>`;
  }).join('') : `<div class="empty-state"><strong>No courses match this view.</strong><br>Try another quarter, credit value, format, or search phrase. Courses already in this quarter of My year are hidden here until you remove them from the plan.</div>`;
  $('load-more').hidden = results.length <= state.visible;
  $('load-more').textContent = `Show more courses (${results.length - state.visible} remaining)`;
}

function renderExcluded() {
  const lookup = byId();
  const courses = excludedIds().map(id => lookup.get(id)).filter(Boolean).sort((a, b) => a.title.localeCompare(b.title));
  $('excluded-panel').hidden = !courses.length;
  $('excluded-count').textContent = courses.length;
  $('excluded-list').innerHTML = courses.map(course => `<div class="excluded-item"><span>${escapeHtml(course.title)}</span><button type="button" data-restore="${escapeHtml(course.id)}" aria-label="Restore ${escapeHtml(course.title)}">Restore</button></div>`).join('');
}

function renderFinalReview(plan) {
  const review = reviewPlan(plan, catalog(), state.prefs);
  const badge = $('review-badge');
  badge.className = `review-badge ${review.blockers.length ? 'needs-fixes' : review.checks.length ? 'needs-checks' : 'review-clear'}`;
  badge.textContent = !review.selectedCount ? 'Add courses first' : review.blockers.length ? `${review.blockers.length} to fix` : review.checks.length ? `${review.checks.length} to verify` : 'No issues found';
  const quarterRows = review.quarters.map(({term, credits, count}) => `<div class="review-quarter"><strong>${term}</strong><span>${credits} / ${state.prefs.target} credits · ${count} ${count === 1 ? 'course' : 'courses'}</span></div>`).join('');
  const issueGroup = (title, items, className) => items.length ? `<div class="review-findings ${className}"><h5>${title} (${items.length})</h5><ul>${items.map(item => `<li>${escapeHtml(item.text)}</li>`).join('')}</ul></div>` : '';
  $('final-review-content').innerHTML = `<p class="review-lede">${review.selectedCount ? review.blockers.length ? 'This draft has conflicts or unavailable selections to resolve.' : review.checks.length ? 'No confirmed time conflict or unavailable selection was found, but these details need checking.' : 'No issues found in the published details for this draft.' : 'Add courses to your draft to review the year.'}</p><div class="review-quarters">${quarterRows}</div>${review.selectedCount ? issueGroup('Needs changes', review.blockers, 'review-blockers') + issueGroup('Things to check', review.checks, 'review-checks') : ''}<p class="review-note">This review uses the saved catalog and published meeting times. Schedules, seats, and entry rules can change; confirm each official listing before enrolling.</p>`;
}

function renderPlan() {
  const plan = currentPlan(); const lookup = byId();
  const activeTheme = state.themes[state.prefs.academicYear] || 'custom';
  $('theme').innerHTML = '<option value="custom">Choose a theme or build your own</option>' + THEMES.map(theme => `<option value="${theme.id}">${escapeHtml(theme.label)}</option>`).join('');
  $('theme').value = activeTheme;
  $('theme-hint').textContent = (THEMES.find(theme => theme.id === activeTheme)?.hint || 'A theme fills your draft with ideas. You can change every choice afterward.') + ' New spin explores different credit mixes. Tap Yes for me again to unpin a course; × removes it from your draft.';
  $('nav-count').textContent = planCount();
  $('plan-total').textContent = `${planCount()} ${planCount() === 1 ? 'course' : 'courses'}`;
  $('plan-terms').innerHTML = TERMS.map(term => {
    const entries = (plan[term] || []).filter(item => lookup.has(item.id));
    const sum = entries.reduce((n, x) => n + Number(x.credits), 0);
    const replacing = state.replacement?.term === term;
    const removed = replacing ? lookup.get(state.replacement.id) : null;
    const suggestions = replacing ? replacementSuggestions(catalog(), recommendationPrefs(), plan, term, state.replacement, state.replacement.themeId || activeTheme) : [];
    const remaining = state.prefs.target - sum;
    const replacementItem = ({course, credits, reason}) => `<div class="replacement-item"><div><a href="${escapeHtml(course.url)}" target="_blank" rel="noopener">${escapeHtml(course.title)} ↗</a><small>${escapeHtml(reason)} · ${escapeHtml(course.modes?.[term] || 'Format TBA')}</small></div><div class="replacement-actions"><button class="replacement-exclude" type="button" data-exclude="${escapeHtml(course.id)}" aria-label="Exclude ${escapeHtml(course.title)} from suggestions">Not for me</button>${pinControl(course, term, false, 'replacement-pin choice-pin')}<label class="sr-only" for="replace-credits-${escapeHtml(course.id)}">Credits for ${escapeHtml(course.title)}</label><select id="replace-credits-${escapeHtml(course.id)}" data-replacement-credit="${escapeHtml(course.id)}">${course.credits.map(n => `<option value="${n}" ${n === credits ? 'selected' : ''}>${n} cr</option>`).join('')}</select><button type="button" data-replace-id="${escapeHtml(course.id)}" data-replace-term="${term}">Add</button></div></div>`;
    const moreSuggestions = suggestions.slice(3);
    const replacementHtml = replacing ? `<div class="replacement-panel"><div class="replacement-head"><strong>Try another ${term.toLowerCase()} course</strong><small>${removed ? `After removing ${escapeHtml(removed.title)} · ` : ''}${remaining > 0 ? `${remaining} credits to reach your target` : 'Quarter target reached'} · ranked by credit fit and interests</small></div>${suggestions.length ? `<div class="replacement-list">${suggestions.slice(0, 3).map(replacementItem).join('')}</div>${moreSuggestions.length ? `<details class="replacement-more"><summary>Show ${moreSuggestions.length} more options</summary><div class="replacement-list">${moreSuggestions.map(replacementItem).join('')}</div></details>` : ''}` : '<p class="replacement-empty">No clear matches with these filters. Browse the full quarter to choose one yourself.</p>'}<button type="button" class="browse-quarter" data-browse-term="${term}">Browse all ${term.toLowerCase()} offerings ↓</button></div>` : '';
    return `<section class="plan-term"><div class="plan-term-head"><div><span>${term}</span><small>${sum} / ${state.prefs.target} credits</small></div><button class="new-spin" type="button" data-spin-term="${term}" aria-label="New ${term} course combination">↻ New spin</button></div><progress max="${state.prefs.target}" value="${Math.min(sum,state.prefs.target)}" aria-label="${term} credits"></progress>${entries.length ? entries.map(item => {
      const course = lookup.get(item.id);
      const choices = pinControl(course, term, !!item.pinned, 'plan-pin choice-pin') + (item.pinned ? '' : `<button class="plan-exclude" type="button" data-exclude="${escapeHtml(course.id)}" data-exclude-term="${term}" aria-label="Exclude ${escapeHtml(course.title)} from suggestions">Not for me</button>`);
      const ilcEditor = course.isIlc ? `<div class="ilc-editor"><label>Working title <input type="text" data-ilc-note="${term}" maxlength="80" value="${escapeHtml(item.note || '')}" placeholder="e.g. Community journalism project"></label><label>Credits <select data-ilc-credits="${term}">${course.credits.map(n => `<option value="${n}" ${n === Number(item.credits) ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>` : '';
      return `<div class="plan-item${item.pinned ? ' is-pinned' : ''}"><div><a href="${escapeHtml(course.url)}" target="_blank" rel="noopener">${escapeHtml(course.title)} ↗</a><small class="plan-meta">${item.credits} cr · ${course.isIlc ? 'Independent study' : escapeHtml(course.modes?.[term] || 'Format TBA')} · ${escapeHtml(compactMeetingTimes(course, term))}</small>${ilcEditor}<div class="plan-choice">${choices}</div></div><button class="plan-remove" type="button" data-remove="${escapeHtml(item.id)}" data-remove-term="${term}" aria-label="Remove ${escapeHtml(course.title)} from ${term}" title="Remove">×</button></div>`;
    }).join('') : '<p class="plan-term-empty">Nothing chosen yet</p>'}${replacementHtml}</section>`;
  }).join('');
  renderFinalReview(plan);
}

function render() { if (!state.data) return; renderControls(); renderCompare(); renderExcluded(); renderCourses(); renderPlan(); }
function updatePrefs() {
  state.visible = 18;
  const theme = state.themes[state.prefs.academicYear];
  if (theme && theme !== 'custom') state.plans[state.prefs.academicYear] = suggestThemePlan(catalog(), recommendationPrefs(), theme, currentPlan());
  state.replacement = null;
  save(); render();
}

function excludeCourse(id, preferredTerm = state.term) {
  const course = byId().get(id);
  if (!course || excludedIds().includes(id)) return;
  if (isPinnedAnywhere(id)) { notify('Remove this Yes for me course with the red × before excluding it.'); return; }
  const year = state.prefs.academicYear;
  (state.excluded[year] ||= []).push(id);
  const theme = state.themes[year] || 'custom';
  const plan = currentPlan();
  const removedTerms = TERMS.filter(term => (plan[term] || []).some(item => item.id === id));
  const removedTerm = removedTerms.includes(preferredTerm) ? preferredTerm : removedTerms[0];
  const removedItem = removedTerm ? plan[removedTerm].find(item => item.id === id) : null;
  for (const term of TERMS) plan[term] = (plan[term] || []).filter(item => item.id !== id);
  if (theme !== 'custom') {
    state.plans[year] = suggestThemePlan(catalog(), recommendationPrefs(), theme, plan);
    state.replacement = null;
  } else if (removedTerm) {
    state.replacement = { term: removedTerm, id, credits: removedItem.credits, themeId: 'custom' };
  }
  state.compare = state.compare.filter(item => item.id !== id);
  save(); render();
  notify('Course excluded. Restore it from the Not for me list.');
}

function restoreCourse(id) {
  const year = state.prefs.academicYear;
  if (!excludedIds().includes(id)) return;
  state.excluded[year] = excludedIds().filter(item => item !== id);
  const theme = state.themes[year] || 'custom';
  if (theme !== 'custom') state.plans[year] = suggestThemePlan(catalog(), recommendationPrefs(), theme, currentPlan());
  save(); render();
  notify('Course restored to your choices.');
}

async function loadYear(year) {
  const record = state.manifest.catalogs.find(item => item.academicYear === year);
  if (!record) return;
  $('result-count').textContent = 'Loading courses…';
  try {
    const response = await fetch(`data/${record.file}`, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Catalog request returned ${response.status}`);
    state.data = await response.json();
    state.prefs.academicYear = year;
    state.plans[year] ||= emptyPlan();
    state.themes[year] ||= 'custom';
    state.excluded[year] = (state.excluded[year] || []).filter(id => id === ILC_ID || state.data.courses.some(course => course.id === id));
    state.replacement = null;
    syncGoalInputs();
    save(); render();
  } catch (error) {
    $('result-count').textContent = 'Could not load the catalog. Please reload the page.';
    console.error(error);
  }
}

function events() {
  $('save-plan-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!state.data) { notify('Wait for the catalog to load before saving a plan.'); return; }
    if (!planCount()) { notify('Add at least one course to My year before saving a plan.'); return; }
    const snapshot = currentSnapshot($('plan-name').value);
    if (persistSavedPlans([snapshot, ...state.savedPlans])) {
      $('plan-name').value = '';
      notify(`Saved ${snapshot.name} in My plans.`);
    }
  });
  $('print-current').addEventListener('click', () => {
    if (!state.data || !planCount()) { notify('Add at least one course to My year before printing.'); return; }
    printPlan(currentSnapshot($('plan-name').value.trim() || 'Current draft'));
  });
  $('saved-plans-list').addEventListener('click', async event => {
    const button = event.target.closest('[data-open-saved], [data-print-saved], [data-remove-saved]');
    if (!button) return;
    const id = button.dataset.openSaved || button.dataset.printSaved || button.dataset.removeSaved;
    const snapshot = state.savedPlans.find(item => item.id === id);
    if (!snapshot) return;
    if (button.dataset.openSaved) await openSavedPlan(snapshot);
    else if (button.dataset.printSaved) printPlan(snapshot);
    else if (window.confirm(`Remove “${snapshot.name}” from My plans? This cannot be undone.`)) {
      if (persistSavedPlans(state.savedPlans.filter(item => item.id !== id))) notify('Saved plan removed.');
    }
  });
  $('goals-accordion').addEventListener('toggle', () => $('setup').classList.toggle('is-collapsed', !$('goals-accordion').open));
  document.querySelector('a[href="#setup-title"]').addEventListener('click', () => { $('goals-accordion').open = true; });
  $('academic-year').addEventListener('change', event => loadYear(event.target.value));
  $('standing').addEventListener('change', event => { state.prefs.standing = event.target.value; updatePrefs(); });
  $('target').addEventListener('change', event => { state.prefs.target = Number(event.target.value); updatePrefs(); });
  $('location').addEventListener('change', event => { state.prefs.location = event.target.value; updatePrefs(); });
  for (const [id, key] of [['career-goals','careerGoals'], ['academic-focus','academicFocus'], ['other-interests','otherInterests'], ['disliked-fields','dislikedFields'], ['completed-courses','completedCourses']]) {
    $(id).addEventListener('input', event => {
      state.prefs[key] = event.target.value;
      save();
      clearTimeout(goalsTimer);
      goalsTimer = setTimeout(updatePrefs, 280);
    });
  }
  $('generate-suggestions').addEventListener('click', () => {
    if (!state.data) { $('suggestion-status').textContent = 'The catalog is still loading. Please try again in a moment.'; return; }
    clearTimeout(goalsTimer);
    updatePrefs();
    const button = $('generate-suggestions');
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    $('generate-suggestions-label').textContent = 'Finding course ideas…';
    $('suggestion-status').textContent = 'Finding course ideas for your year…';
    clearTimeout(suggestionsTimer);
    suggestionsTimer = setTimeout(() => {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      $('generate-suggestions-label').textContent = 'Refresh course suggestions';
      state.query = ''; $('search').value = '';
      state.creditFilter = 0; $('credit-filter').value = '0';
      state.sort = 'relevance'; $('sort').value = 'relevance';
      state.visible = 18;
      save(); renderCourses();
      $('suggestion-status').textContent = `Showing best matches for ${state.term.toLowerCase()} in Explore courses.`;
      $('goals-accordion').open = false;
      $('setup').classList.add('is-collapsed');
      $('explore').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 650);
  });
  $('theme').addEventListener('change', event => {
    const id = event.target.value;
    if (id !== 'custom' && !THEMES.some(theme => theme.id === id)) return;
    state.themes[state.prefs.academicYear] = id;
    if (id !== 'custom') state.plans[state.prefs.academicYear] = suggestThemePlan(catalog(), recommendationPrefs(), id, currentPlan());
    state.replacement = null;
    save(); renderCourses(); renderPlan();
    if (id !== 'custom') notify(`${THEMES.find(theme => theme.id === id).label} added to your draft.`);
  });
  $('formats').addEventListener('click', event => { const mode = event.target.closest('[data-format]')?.dataset.format; if (!mode) return; const next = state.prefs.formats.includes(mode) ? state.prefs.formats.filter(x => x !== mode) : [...state.prefs.formats,mode]; if (!next.length) { notify('Keep at least one learning format selected.'); return; } state.prefs.formats = next; updatePrefs(); });
  $('browse-terms').addEventListener('click', event => { const term = event.target.closest('[data-term]')?.dataset.term; if (!term) return; state.term = term; state.visible = 18; renderControls(); renderCourses(); });
  $('search').addEventListener('input', event => { state.query = event.target.value.trim().toLowerCase(); state.visible = 18; renderCourses(); });
  $('credit-filter').addEventListener('change', event => { state.creditFilter = Number(event.target.value) || 0; state.visible = 18; save(); renderCourses(); });
  $('sort').addEventListener('change', event => { state.sort = event.target.value; renderCourses(); });
  $('load-more').addEventListener('click', () => { state.visible += 18; renderCourses(); });
  $('excluded-list').addEventListener('click', event => {
    const id = event.target.closest('[data-restore]')?.dataset.restore;
    if (id) restoreCourse(id);
  });
  $('course-list').addEventListener('click', event => {
    const pin = event.target.closest('[data-pin-id]');
    if (pin) {
      const id = pin.dataset.pinId;
      togglePinCourse(id, pin.dataset.pinTerm || state.term, Number(document.querySelector(`[data-credit-for="${id}"]`)?.value));
      return;
    }
    const exclude = event.target.closest('[data-exclude]')?.dataset.exclude;
    if (exclude) { excludeCourse(exclude); return; }
    const compareId = event.target.closest('[data-compare]')?.dataset.compare;
    if (compareId) {
      const existing = state.compare.findIndex(item => item.id === compareId && item.term === state.term);
      if (existing >= 0) state.compare.splice(existing, 1);
      else {
        if (state.compare.length >= 3) { notify('Compare up to three offerings at a time.'); return; }
        state.compare.push({ id: compareId, term: state.term });
      }
      save(); renderCompare(); renderCourses();
      if (existing < 0) $('compare').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const all = event.target.closest('[data-add-all]');
    const id = all?.dataset.addAll || event.target.closest('[data-add]')?.dataset.add;
    if (!id) return;
    const course = byId().get(id);
    const credits = Number(document.querySelector(`[data-credit-for="${id}"]`)?.value);
    if (!course || !course.credits.includes(credits)) return;
    const plan = currentPlan();
    const terms = all ? TERMS.filter(term => offeringAvailable(course, term, state.prefs)) : [state.term];
    for (const term of terms) if (!(plan[term] || []).some(item => item.id === id)) plan[term].push({ id, credits, ...(course.isIlc ? { pinned: true } : {}) });
    state.themes[state.prefs.academicYear] = 'custom'; state.replacement = null;
    save(); renderCourses(); renderPlan();
    notify(course.isIlc ? `ILC added to ${state.term}. Add a working title in My year.` : all ? 'Added across its offered quarters.' : `Added to ${state.term}.`);
  });
  $('compare-grid').addEventListener('click', event => {
    const pin = event.target.closest('[data-pin-id]');
    if (pin) {
      const course = byId().get(pin.dataset.pinId);
      const credits = course?.credits.filter(n => n <= state.prefs.target).at(-1) ?? course?.credits[0];
      togglePinCourse(pin.dataset.pinId, pin.dataset.pinTerm, credits);
      return;
    }
    const exclude = event.target.closest('[data-exclude]')?.dataset.exclude;
    if (exclude) { excludeCourse(exclude); return; }
    const button = event.target.closest('[data-uncompare]');
    if (!button) return;
    state.compare = state.compare.filter(item => !(item.id === button.dataset.uncompare && item.term === button.dataset.uncompareTerm));
    save(); renderCompare(); renderCourses();
  });
  $('clear-compare').addEventListener('click', () => { state.compare = []; save(); renderCompare(); renderCourses(); });
  $('plan-terms').addEventListener('input', event => {
    const input = event.target.closest('[data-ilc-note]');
    if (!input) return;
    const item = (currentPlan()[input.dataset.ilcNote] || []).find(entry => entry.id === ILC_ID);
    if (item) { item.note = input.value.slice(0, 80); save(); }
  });
  $('plan-terms').addEventListener('change', event => {
    const select = event.target.closest('[data-ilc-credits]');
    if (!select) return;
    const item = (currentPlan()[select.dataset.ilcCredits] || []).find(entry => entry.id === ILC_ID);
    const credits = Number(select.value);
    if (!item || !ILC.credits.includes(credits)) return;
    item.credits = credits;
    save(); renderCourses(); renderPlan();
  });
  $('plan-terms').addEventListener('click', event => {
    const spin = event.target.closest('[data-spin-term]');
    if (spin) {
      const term = spin.dataset.spinTerm;
      const plan = currentPlan();
      const before = (plan[term] || []).map(item => `${item.id}:${item.credits}`).join('|');
      const theme = state.themes[state.prefs.academicYear] || 'core';
      const spins = state.spins[state.prefs.academicYear] ||= {};
      plan[term] = spinQuarterPlan(catalog(), recommendationPrefs(), plan, term, theme, spins[term] || 0);
      spins[term] = (spins[term] || 0) + 1;
      const after = plan[term].map(item => `${item.id}:${item.credits}`).join('|');
      state.replacement = null;
      save(); renderCourses(); renderPlan();
      notify(before === after ? `No different compatible ${term.toLowerCase()} mix was found.` : `New ${term.toLowerCase()} mix: ${plan[term].map(item => item.credits).join(' + ')} credits. Your Yes for me courses stayed put.`);
      return;
    }
    const pin = event.target.closest('[data-pin-id]');
    if (pin) {
      const id = pin.dataset.pinId, term = pin.dataset.pinTerm;
      const existing = (currentPlan()[term] || []).find(item => item.id === id);
      const credits = existing?.credits ?? Number(pin.closest('.replacement-item')?.querySelector('[data-replacement-credit]')?.value);
      togglePinCourse(id, term, credits);
      return;
    }
    const exclude = event.target.closest('[data-exclude]')?.dataset.exclude;
    if (exclude) { excludeCourse(exclude, event.target.closest('[data-exclude]').dataset.excludeTerm || state.replacement?.term || state.term); return; }
    const remove = event.target.closest('[data-remove]');
    if (remove) {
      const plan = currentPlan();
      const term = remove.dataset.removeTerm;
      const item = (plan[term] || []).find(item => item.id === remove.dataset.remove);
      if (!item) return;
      plan[term] = plan[term].filter(item => item.id !== remove.dataset.remove);
      const themeId = state.themes[state.prefs.academicYear] || 'custom';
      state.themes[state.prefs.academicYear] = 'custom';
      state.replacement = { term, id: item.id, credits: item.credits, themeId };
      save(); renderCourses(); renderPlan();
      return;
    }
    const replace = event.target.closest('[data-replace-id]');
    if (replace) {
      const id = replace.dataset.replaceId, term = replace.dataset.replaceTerm;
      const course = byId().get(id);
      const credits = Number(replace.closest('.replacement-item')?.querySelector('[data-replacement-credit]')?.value);
      if (!course?.credits.includes(credits) || (currentPlan()[term] || []).some(item => item.id === id)) return;
      currentPlan()[term].push({ id, credits });
      state.themes[state.prefs.academicYear] = 'custom'; state.replacement = null;
      save(); renderCourses(); renderPlan(); notify(`Added to ${term}.`);
      return;
    }
    const browse = event.target.closest('[data-browse-term]');
    if (browse) {
      state.term = browse.dataset.browseTerm; state.visible = 18;
      renderControls(); renderCourses();
      $('explore').scrollIntoView({ behavior:'smooth', block:'start' });
    }
  });
  $('clear-plan').addEventListener('click', () => {
    state.plans[state.prefs.academicYear] = Object.fromEntries(TERMS.map(term =>
      [term, (currentPlan()[term] || []).filter(item => item.pinned)]));
    state.themes[state.prefs.academicYear] = 'custom'; state.replacement = null;
    save(); renderCourses(); renderPlan(); notify('Other courses cleared. Your Yes for me choices remain.');
  });
  $('reset').addEventListener('click', () => {
    clearTimeout(goalsTimer); clearTimeout(suggestionsTimer);
    const button = $('generate-suggestions');
    button.disabled = false; button.removeAttribute('aria-busy');
    $('generate-suggestions-label').textContent = 'Generate relevant course suggestions';
    $('suggestion-status').textContent = 'Course matches also adjust automatically as you edit your answers.';
    const path = location.pathname.replace(/[^/]*$/, '') || '/';
    document.cookie = `${COOKIE}=; Max-Age=0; Path=${path}; SameSite=Lax`;
    document.cookie = `${EXCLUDED_COOKIE}=; Max-Age=0; Path=${path}; SameSite=Lax`;
    state.prefs = { ...defaults, formats: [...FORMATS], academicYear: state.manifest.catalogs[0].academicYear };
    state.plans = Object.fromEntries(Object.entries(state.plans).map(([year, plan]) =>
      [year, Object.fromEntries(TERMS.map(term => [term, (plan[term] || []).filter(item => item.pinned)]))]));
    state.themes = {}; state.spins = {}; state.excluded = {}; state.replacement = null; state.compare = [];
    state.term = 'Fall'; state.query = ''; state.creditFilter = 0;
    $('search').value = ''; $('sort').value = 'relevance'; state.sort = 'relevance'; state.visible = 18;
    syncGoalInputs(); save();
    if (state.data.academicYear === state.prefs.academicYear) render();
    else loadYear(state.prefs.academicYear);
    notify('Other choices reset. Your Yes for me courses remain.');
  });
  $('copy-plan').addEventListener('click', async () => { const lookup = byId(); const lines = [`Evergreen Course Mapper — ${state.prefs.academicYear}`]; for (const term of TERMS) { const entries = currentPlan()[term] || []; lines.push(`\n${term} (${entries.reduce((n,x)=>n+Number(x.credits),0)} credits)`); entries.forEach(item => { const c = lookup.get(item.id); if (c) lines.push(`• ${c.isIlc && item.note?.trim() ? `ILC: ${item.note.trim()}` : c.title} — ${item.credits} credits — ${c.url}`); }); } lines.push('\nCheck official course listings before enrolling.'); try { await navigator.clipboard.writeText(lines.join('\n')); notify('Plan summary copied.'); } catch { notify('Clipboard unavailable in this browser.'); } });
}

async function start() {
  readCookie(); readExcludedCookie(); readSavedPlans(); events(); renderSavedPlans();
  try {
    const response = await fetch('data/manifest.json', { cache:'no-cache' });
    if (!response.ok) throw new Error(`Manifest request returned ${response.status}`);
    state.manifest = await response.json();
    if (!state.manifest.catalogs?.length) throw new Error('No academic years in manifest');
    const chosen = state.manifest.catalogs.some(item => item.academicYear === state.prefs.academicYear) ? state.prefs.academicYear : state.manifest.catalogs[0].academicYear;
    await loadYear(chosen);
  } catch (error) {
    $('data-note').textContent = 'Catalog could not be loaded. Please try refreshing.';
    $('result-count').textContent = 'Catalog unavailable';
    console.error(error);
  }
}
start();
