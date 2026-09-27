import { TERMS, STANDINGS, FORMATS, INTERESTS, interestTags, offeringAvailable, planIssues, suggestedPaths } from './planner.js';

const COOKIE = 'evergreen-course-map-v1';
const $ = id => document.getElementById(id);
const emptyPlan = () => Object.fromEntries(TERMS.map(term => [term, []]));
const defaults = { academicYear: '', standing: 'Freshman', target: 16, location: 'Any location', interests: [], formats: [...FORMATS] };
const state = { prefs: { ...defaults }, plans: {}, compare: [], term: 'Fall', query: '', sort: 'relevance', visible: 18, data: null, manifest: null };
let toastTimer;

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
      interests: Array.isArray(prefs.interests) ? prefs.interests.filter(x => INTERESTS.some(item => item.id === x)) : [],
      formats: Array.isArray(prefs.formats) && prefs.formats.length ? prefs.formats.filter(x => FORMATS.includes(x)) : [...FORMATS],
    };
    if (data.plans && typeof data.plans === 'object') state.plans = data.plans;
    if (Array.isArray(data.compare)) state.compare = data.compare.filter(item => item && typeof item.id === 'string' && TERMS.includes(item.term)).slice(0, 3);
  } catch { /* An old or malformed cookie should not stop the planner. */ }
}

function save() {
  const value = encodeURIComponent(JSON.stringify({ prefs: state.prefs, plans: state.plans, compare: state.compare }));
  const path = location.pathname.replace(/[^/]*$/, '') || '/';
  document.cookie = `${COOKIE}=${value}; Max-Age=31536000; Path=${path}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function notify(message) {
  const toast = $('toast'); toast.textContent = message; toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function catalog() { return state.data?.courses || []; }
function byId() { return new Map(catalog().map(course => [course.id, course])); }
function currentPlan() { return state.plans[state.prefs.academicYear] || emptyPlan(); }
function planCount() { return TERMS.reduce((n, term) => n + (currentPlan()[term] || []).length, 0); }
function matchingCourses() {
  return catalog().filter(course => offeringAvailable(course, state.term, state.prefs))
    .filter(course => !state.query || `${course.title} ${course.description} ${(course.fields || []).join(' ')}`.toLowerCase().includes(state.query));
}
function relevance(course) {
  const tags = interestTags(course);
  return tags.filter(tag => state.prefs.interests.includes(tag)).length * 10
    + (course.type === 'Program' ? 1 : 0)
    + ((course.meetings?.[state.term] || []).length ? 1 : 0);
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
  $('interests').innerHTML = INTERESTS.map(item => `<button class="chip" type="button" data-interest="${item.id}" aria-pressed="${p.interests.includes(item.id)}">${escapeHtml(item.label)}</button>`).join('');
  $('formats').innerHTML = FORMATS.map(mode => `<button class="chip" type="button" data-format="${escapeHtml(mode)}" aria-pressed="${p.formats.includes(mode)}">${escapeHtml(mode)}</button>`).join('');
  $('browse-terms').innerHTML = TERMS.map(term => `<button type="button" data-term="${term}" aria-pressed="${state.term === term}">${term}</button>`).join('');
  $('data-note').textContent = `${state.data.courses.length} undergraduate offerings · ${state.prefs.academicYear} · refreshed ${new Date(state.data.updatedAt).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'})} from Evergreen’s catalog`;
}

function renderPaths() {
  const suggestions = suggestedPaths(catalog(), state.prefs);
  $('path-grid').innerHTML = suggestions.map((path, index) => `<article class="path-card"><div class="path-card-inner"><div class="path-number">PATH 0${index + 1}</div><h3>${escapeHtml(path.title)}</h3><p class="path-hint">${escapeHtml(path.hint)}</p>${TERMS.map(term => {
    const entries = path.plan[term] || [];
    const total = entries.reduce((n, entry) => n + entry.credits, 0);
    return `<div class="path-term"><div class="path-term-head"><span>${term}</span><span>${total} / ${state.prefs.target} credits</span></div>${entries.length ? entries.map(entry => { const course = catalog().find(c => c.id === entry.id); return `<div class="path-course">${escapeHtml(course?.title || '')} <span>· ${entry.credits} cr</span></div>`; }).join('') : '<div class="path-course path-empty">No combination found</div>'}</div>`;
  }).join('')}<button type="button" class="button-primary" data-path="${path.id}">Use this path</button></div></article>`).join('');
}

function renderCompare() {
  const lookup = byId();
  state.compare = state.compare.filter(item => lookup.has(item.id) && lookup.get(item.id).offerings?.[item.term]);
  $('compare').hidden = !state.compare.length;
  $('compare-grid').innerHTML = state.compare.map(item => {
    const course = lookup.get(item.id);
    const schedule = scheduleText(course, item.term) || 'Check official schedule';
    const fields = (course.fields || []).slice(0, 3).join(' · ');
    return `<article class="compare-card"><div class="compare-card-head"><span class="pill gold">${item.term}</span><button type="button" data-uncompare="${escapeHtml(item.id)}" data-uncompare-term="${item.term}" aria-label="Remove ${escapeHtml(course.title)} from comparison">×</button></div><h4>${escapeHtml(course.title)}</h4><div class="compare-facts"><div><span>Credits</span><strong>${escapeHtml(course.credits.join(' or '))}</strong></div><div><span>Format</span><strong>${escapeHtml(course.modes?.[item.term] || 'TBA')}</strong></div><div><span>Location</span><strong>${escapeHtml(course.location || 'See listing')}</strong></div><div><span>Meeting</span><strong>${escapeHtml(schedule)}</strong></div></div><p class="compare-fields">${escapeHtml(fields)}</p><p class="compare-desc">${escapeHtml((course.description || '').slice(0, 420) || 'Read the official listing for course details.')}${(course.description || '').length > 420 ? '…' : ''}</p>${course.prerequisites && !/^none\b|^no prerequisites/i.test(course.prerequisites) ? '<p class="compare-caution">Entry requirements: check the official listing.</p>' : ''}<a href="${escapeHtml(course.url)}" target="_blank" rel="noopener">Read official listing ↗</a></article>`;
  }).join('') + (state.compare.length < 2 ? '<div class="compare-placeholder">Choose another course to compare it here.</div>' : '');
}

function renderCourses() {
  let results = matchingCourses();
  if (state.sort === 'title') results.sort((a,b) => a.title.localeCompare(b.title));
  else if (state.sort === 'credits') results.sort((a,b) => Math.max(...b.credits) - Math.max(...a.credits) || a.title.localeCompare(b.title));
  else results.sort((a,b) => relevance(b) - relevance(a) || a.title.localeCompare(b.title));
  $('result-count').textContent = `${results.length} ${results.length === 1 ? 'offering' : 'offerings'} for ${state.term.toLowerCase()}${state.prefs.interests.length ? ' · ranked by your interests' : ''}`;
  const shown = results.slice(0, state.visible);
  $('course-list').innerHTML = shown.length ? shown.map(course => {
    const inPlan = (currentPlan()[state.term] || []).some(item => item.id === course.id);
    const comparing = state.compare.some(item => item.id === course.id && item.term === state.term);
    const availableCredits = course.credits.filter(n => n <= state.prefs.target);
    const preferred = availableCredits.at(-1);
    const mode = course.modes?.[state.term] || 'Format TBA';
    const schedule = scheduleText(course, state.term);
    const location = course.location && course.location !== 'Olympia' ? course.location : '';
    const offeredTerms = TERMS.filter(term => course.offerings?.[term]);
    const otherTerms = offeredTerms.filter(term => term !== state.term);
    const status = course.offerings?.[state.term]?.status || '';
    return `<article class="course-card" data-course="${escapeHtml(course.id)}"><div class="course-top"><a class="course-title" href="${escapeHtml(course.url)}" target="_blank" rel="noopener">${escapeHtml(course.title)} ↗</a></div><div class="course-meta"><span class="pill gold">${escapeHtml(course.type)}</span><span class="pill">${escapeHtml(mode)}</span><span class="pill neutral">${escapeHtml(course.credits.join(' or '))} cr</span>${location ? `<span class="pill neutral">${escapeHtml(location)}</span>` : ''}${otherTerms.length ? `<span class="pill neutral">Also ${escapeHtml(otherTerms.join(' + '))}</span>` : ''}${status === 'Conditional' ? '<span class="pill gold">Conditional entry</span>' : ''}${course.prerequisites && !/^none\b|^no prerequisites/i.test(course.prerequisites) ? '<span class="pill gold">Entry requirements</span>' : ''}</div><p class="course-desc">${escapeHtml(course.description || (course.fields || []).join(' · ') || 'Read the official catalog entry for course details.')}</p>${schedule ? `<p class="course-extra">Meets ${escapeHtml(schedule)}${course.timeOffered ? ` · ${escapeHtml(course.timeOffered)}` : ''}</p>` : '<p class="course-extra">Meeting times: see official schedule</p>'}<div class="course-actions"><div class="course-links"><a href="${escapeHtml(course.scheduleUrl || course.url)}" target="_blank" rel="noopener">${course.scheduleUrl ? 'Full schedule' : 'Catalog details'} ↗</a><button class="compare-button" type="button" data-compare="${course.id}">${comparing ? 'Remove comparison' : 'Compare'}</button></div><div class="credit-picker"><label for="credits-${course.id}">Credits</label><select id="credits-${course.id}" data-credit-for="${course.id}">${availableCredits.map(n => `<option value="${n}" ${n === preferred ? 'selected' : ''}>${n}</option>`).join('')}</select><button class="add-button" type="button" data-add="${course.id}" ${inPlan ? 'disabled' : ''}>${inPlan ? 'Added' : `Add to ${state.term}`}</button></div></div>${otherTerms.length ? `<button type="button" class="add-all" data-add-all="${course.id}">Add ${escapeHtml(offeredTerms.join(' + '))}</button>` : ''}</article>`;
  }).join('') : `<div class="empty-state"><strong>No courses match this view.</strong><br>Try another quarter, format, credit target, or search phrase.</div>`;
  $('load-more').hidden = results.length <= state.visible;
  $('load-more').textContent = `Show more courses (${results.length - state.visible} remaining)`;
}

function renderPlan() {
  const plan = currentPlan(); const lookup = byId();
  $('nav-count').textContent = planCount();
  $('plan-total').textContent = `${planCount()} ${planCount() === 1 ? 'course' : 'courses'}`;
  $('plan-terms').innerHTML = TERMS.map(term => {
    const entries = (plan[term] || []).filter(item => lookup.has(item.id));
    const sum = entries.reduce((n, x) => n + Number(x.credits), 0);
    return `<section class="plan-term"><div class="plan-term-head"><span>${term}</span><span>${sum} / ${state.prefs.target} credits</span></div><progress max="${state.prefs.target}" value="${Math.min(sum,state.prefs.target)}" aria-label="${term} credits"></progress>${entries.length ? entries.map(item => {
      const course = lookup.get(item.id);
      return `<div class="plan-item"><div><a href="${escapeHtml(course.url)}" target="_blank" rel="noopener">${escapeHtml(course.title)} ↗</a><small>${item.credits} credits · ${escapeHtml(course.modes?.[term] || 'Format TBA')}</small></div><button type="button" data-remove="${escapeHtml(item.id)}" data-remove-term="${term}" aria-label="Remove ${escapeHtml(course.title)} from ${term}" title="Remove">×</button></div>`;
    }).join('') : '<p class="plan-term-empty">Nothing chosen yet</p>'}</section>`;
  }).join('');
  const issues = planIssues(plan, catalog(), state.prefs.target);
  $('plan-issues').innerHTML = planCount() && !issues.length ? '<div class="issue-ok">No credit or published time conflicts found.</div>' : issues.slice(0, 8).map(issue => `<div class="issue ${escapeHtml(issue.kind)}">${escapeHtml(issue.text)}</div>`).join('') + (issues.length > 8 ? `<div class="issue">${issues.length - 8} more items to check on the official schedule.</div>` : '');
}

function render() { if (!state.data) return; renderControls(); renderPaths(); renderCompare(); renderCourses(); renderPlan(); }
function updatePrefs() { state.visible = 18; save(); render(); }

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
    save(); render();
  } catch (error) {
    $('result-count').textContent = 'Could not load the catalog. Please reload the page.';
    console.error(error);
  }
}

function events() {
  $('academic-year').addEventListener('change', event => loadYear(event.target.value));
  $('standing').addEventListener('change', event => { state.prefs.standing = event.target.value; updatePrefs(); });
  $('target').addEventListener('change', event => { state.prefs.target = Number(event.target.value); updatePrefs(); });
  $('location').addEventListener('change', event => { state.prefs.location = event.target.value; updatePrefs(); });
  $('interests').addEventListener('click', event => { const id = event.target.closest('[data-interest]')?.dataset.interest; if (!id) return; state.prefs.interests = state.prefs.interests.includes(id) ? state.prefs.interests.filter(x => x !== id) : [...state.prefs.interests,id]; updatePrefs(); });
  $('formats').addEventListener('click', event => { const mode = event.target.closest('[data-format]')?.dataset.format; if (!mode) return; const next = state.prefs.formats.includes(mode) ? state.prefs.formats.filter(x => x !== mode) : [...state.prefs.formats,mode]; if (!next.length) { notify('Keep at least one learning format selected.'); return; } state.prefs.formats = next; updatePrefs(); });
  $('browse-terms').addEventListener('click', event => { const term = event.target.closest('[data-term]')?.dataset.term; if (!term) return; state.term = term; state.visible = 18; renderControls(); renderCourses(); });
  $('search').addEventListener('input', event => { state.query = event.target.value.trim().toLowerCase(); state.visible = 18; renderCourses(); });
  $('sort').addEventListener('change', event => { state.sort = event.target.value; renderCourses(); });
  $('load-more').addEventListener('click', () => { state.visible += 18; renderCourses(); });
  $('course-list').addEventListener('click', event => { const compareId = event.target.closest('[data-compare]')?.dataset.compare; if (compareId) { const existing = state.compare.findIndex(item => item.id === compareId && item.term === state.term); if (existing >= 0) state.compare.splice(existing, 1); else { if (state.compare.length >= 3) { notify('Compare up to three offerings at a time.'); return; } state.compare.push({ id: compareId, term: state.term }); } save(); renderCompare(); renderCourses(); if (existing < 0) $('compare').scrollIntoView({ behavior:'smooth', block:'start' }); return; } const all = event.target.closest('[data-add-all]'); const id = all?.dataset.addAll || event.target.closest('[data-add]')?.dataset.add; if (!id) return; const course = byId().get(id); const credits = Number(document.querySelector(`[data-credit-for="${id}"]`)?.value); if (!course || !course.credits.includes(credits)) return; const plan = currentPlan(); const terms = all ? TERMS.filter(term => course.offerings?.[term]) : [state.term]; for (const term of terms) if (!(plan[term] || []).some(item => item.id === id)) plan[term].push({ id, credits }); save(); renderCourses(); renderPlan(); notify(all ? 'Added across its offered quarters.' : `Added to ${state.term}.`); });
  $('compare-grid').addEventListener('click', event => { const button = event.target.closest('[data-uncompare]'); if (!button) return; state.compare = state.compare.filter(item => !(item.id === button.dataset.uncompare && item.term === button.dataset.uncompareTerm)); save(); renderCompare(); renderCourses(); });
  $('clear-compare').addEventListener('click', () => { state.compare = []; save(); renderCompare(); renderCourses(); });
  $('plan-terms').addEventListener('click', event => { const button = event.target.closest('[data-remove]'); if (!button) return; const plan = currentPlan(); plan[button.dataset.removeTerm] = (plan[button.dataset.removeTerm] || []).filter(item => item.id !== button.dataset.remove); save(); renderCourses(); renderPlan(); });
  $('path-grid').addEventListener('click', event => { const id = event.target.closest('[data-path]')?.dataset.path; if (!id) return; const path = suggestedPaths(catalog(), state.prefs).find(item => item.id === id); if (!path) return; state.plans[state.prefs.academicYear] = structuredClone(path.plan); save(); renderCourses(); renderPlan(); $('plan').scrollIntoView({ behavior:'smooth', block:'start' }); notify(`“${path.title}” is now your draft plan.`); });
  $('clear-plan').addEventListener('click', () => { state.plans[state.prefs.academicYear] = emptyPlan(); save(); renderCourses(); renderPlan(); notify('Draft plan cleared.'); });
  $('reset').addEventListener('click', () => { const path = location.pathname.replace(/[^/]*$/, '') || '/'; document.cookie = `${COOKIE}=; Max-Age=0; Path=${path}; SameSite=Lax`; state.prefs = { ...defaults, interests: [], formats: [...FORMATS], academicYear: state.manifest.catalogs[0].academicYear }; state.plans = {}; state.compare = []; state.term = 'Fall'; state.query = ''; $('search').value = ''; $('sort').value = 'relevance'; state.sort = 'relevance'; state.visible = 18; if (state.data.academicYear === state.prefs.academicYear) render(); else loadYear(state.prefs.academicYear); notify('Saved choices cleared.'); });
  $('copy-plan').addEventListener('click', async () => { const lookup = byId(); const lines = [`Evergreen Course Map — ${state.prefs.academicYear}`]; for (const term of TERMS) { const entries = currentPlan()[term] || []; lines.push(`\n${term} (${entries.reduce((n,x)=>n+Number(x.credits),0)} credits)`); entries.forEach(item => { const c = lookup.get(item.id); if (c) lines.push(`• ${c.title} — ${item.credits} credits — ${c.url}`); }); } lines.push('\nCheck official course listings before enrolling.'); try { await navigator.clipboard.writeText(lines.join('\n')); notify('Plan summary copied.'); } catch { notify('Clipboard unavailable in this browser.'); } });
}

async function start() {
  readCookie(); events();
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
