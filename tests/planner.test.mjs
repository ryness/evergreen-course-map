import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compactMeetingTimes, courseConflict, offeringAvailable, planIssues, reviewPlan, TERMS } from '../planner.js';
import { THEMES, courseAlreadyTaken, courseRelevance, replacementSuggestions, spinQuarterPlan, suggestThemePlan } from '../recommend.js';

const meeting = (day, start, end, weeks = [1, 2, 3]) => ({ day, start, end, weeks });
const makeCourse = (id, title, credits, meetings, extra = {}) => ({
  id, title, type: 'Course', fields: [], description: '', credits: [credits],
  standings: ['Sophomore'], modes: { Fall: 'In person' },
  offerings: { Fall: { status: 'Open' } }, meetings: { Fall: meetings },
  location: 'Olympia', ...extra,
});
const prefs = { standing: 'Sophomore', target: 20, location: 'Olympia', formats: ['In person', 'Hybrid'], academicFocus: 'law, writing', careerGoals: 'lawyer', otherInterests: '', completedCourses: '' };

test('availability respects standing, mode, campus, and closed status without hiding larger credits', () => {
  const course = makeCourse('a', 'Constitutional Law', 8, []);
  assert.equal(offeringAvailable(course, 'Fall', prefs), true);
  assert.equal(offeringAvailable(course, 'Winter', prefs), false);
  assert.equal(offeringAvailable(course, 'Fall', { ...prefs, standing: 'Freshman' }), false);
  assert.equal(offeringAvailable(course, 'Fall', { ...prefs, target: 4 }), true);
  assert.equal(offeringAvailable({ ...course, location: 'Tacoma' }, 'Fall', prefs), false);
  assert.equal(offeringAvailable({ ...course, modes: { Fall: 'Remote' } }, 'Fall', prefs), false);
  assert.equal(offeringAvailable({ ...course, offerings: { Fall: { status: 'Closed' } } }, 'Fall', prefs), false);
});

test('schedule conflicts require overlapping days, times, and weeks', () => {
  const a = makeCourse('a', 'A', 4, [meeting('Mon', 600, 720, [1, 2])]);
  const b = makeCourse('b', 'B', 4, [meeting('Mon', 700, 760, [3, 4])]);
  assert.equal(courseConflict(a, b, 'Fall'), false);
  b.meetings.Fall[0].weeks = [2, 3];
  assert.equal(courseConflict(a, b, 'Fall'), true);
  b.meetings.Fall[0].day = 'Tue';
  assert.equal(courseConflict(a, b, 'Fall'), false);
});

test('quarter cards show every distinct published meeting block in a compact form', () => {
  const course = makeCourse('a', 'Studio', 8, [
    meeting('Mon', 600, 720), meeting('Wed', 600, 720), meeting('Fri', 600, 720),
    meeting('Tue', 780, 890), meeting('Thu', 780, 890),
  ]);
  assert.equal(compactMeetingTimes(course, 'Fall'), 'M/W/F 10am–12pm · Tu/Th 1–2:50pm');
  assert.equal(compactMeetingTimes(course, 'Winter'), 'Meeting times not published');
});

test('final review names each actual overlap and its shared weeks', () => {
  const a = makeCourse('a', 'Seminar', 8, [meeting('Mon', 600, 720, [1, 2, 3]), meeting('Wed', 780, 900, [2, 3])]);
  const b = makeCourse('b', 'Workshop', 4, [meeting('Mon', 660, 780, [2, 3, 4]), meeting('Wed', 840, 960, [3, 4])]);
  const review = reviewPlan({ Fall: [{ id: 'a', credits: 8 }, { id: 'b', credits: 4 }] }, [a, b], prefs);
  const conflict = review.blockers.find(item => item.kind === 'clash');
  assert.match(conflict.text, /Mon 11am–12pm \(weeks 2–3\)/);
  assert.match(conflict.text, /Wed 2–3pm \(week 3\)/);
});

test('plan review flags credit overload and actual conflicts', () => {
  const a = makeCourse('a', 'Law and Society', 16, [meeting('Tue', 600, 720)]);
  const b = makeCourse('b', 'Civic Writing', 8, [meeting('Tue', 700, 760)]);
  const issues = planIssues({ Fall: [{ id: 'a', credits: 16 }, { id: 'b', credits: 8 }], Winter: [], Spring: [] }, [a, b], 20);
  assert.ok(issues.some(item => item.kind === 'over'));
  assert.ok(issues.some(item => item.kind === 'clash'));
});

test('final review distinguishes a workable draft from conflicts and unknowns', () => {
  const fall = makeCourse('fall', 'Fall Seminar', 8, [meeting('Mon', 600, 720)]);
  const winter = makeCourse('winter', 'Winter Studio', 8, [], { offerings: { Winter: { status: 'Open' } }, modes: { Winter: 'In person' }, meetings: { Winter: [meeting('Tue', 600, 720)] } });
  const spring = makeCourse('spring', 'Spring Workshop', 8, [], { offerings: { Spring: { status: 'Open' } }, modes: { Spring: 'In person' }, meetings: { Spring: [meeting('Wed', 600, 720)] } });
  const plan = { Fall: [{ id: 'fall', credits: 8 }], Winter: [{ id: 'winter', credits: 8 }], Spring: [{ id: 'spring', credits: 8 }] };
  const preferences = { ...prefs, target: 8 };
  const ready = reviewPlan(plan, [fall, winter, spring], preferences);
  assert.equal(ready.blockers.length, 0);
  assert.equal(ready.checks.length, 0);
  const clash = makeCourse('clash', 'Conflicting Seminar', 4, [meeting('Mon', 660, 780)]);
  const conflict = reviewPlan({ ...plan, Fall: [...plan.Fall, { id: 'clash', credits: 4 }] }, [fall, winter, spring, clash], preferences);
  assert.ok(conflict.blockers.some(item => item.kind === 'clash'));
  const uncertain = reviewPlan({ ...plan, Spring: [] }, [fall, winter, { ...spring, meetings: { Spring: [] } }], preferences);
  assert.ok(uncertain.checks.some(item => item.kind === 'empty'));
  const missingTime = reviewPlan(plan, [fall, winter, { ...spring, meetings: { Spring: [] } }], preferences);
  assert.ok(missingTime.checks.some(item => item.kind === 'unknown'));
});

test('final review catches unavailable offerings, standing, and invalid credits', () => {
  const course = makeCourse('a', 'Limited Seminar', 8, [meeting('Mon', 600, 720)], { standings: ['Junior'], offerings: { Fall: { status: 'Closed' } } });
  const review = reviewPlan({ Fall: [{ id: 'a', credits: 4 }], Winter: [], Spring: [] }, [course], { ...prefs, target: 8 });
  assert.ok(review.blockers.some(item => item.kind === 'unavailable'));
  assert.ok(review.blockers.some(item => item.kind === 'standing'));
  assert.ok(review.blockers.some(item => item.kind === 'credits'));
  assert.ok(review.checks.some(item => item.kind === 'empty'));
});

test('eight themes avoid completed and special-entry courses while fitting each quarter', () => {
  const courses = [
    makeCourse('a', 'Community Law', 16, [meeting('Mon', 600, 720)], { type: 'Program' }),
    makeCourse('b', 'Public Writing', 4, [meeting('Tue', 600, 720)]),
    makeCourse('c', 'Advanced Constitutional Law', 4, [meeting('Wed', 600, 720)], { prerequisites: 'One year of law study' }),
    makeCourse('d', 'Prior Learning from Experience Preparatory', 4, [meeting('Thu', 600, 720)]),
  ];
  assert.equal(THEMES.length, 8);
  for (const theme of THEMES) {
    const plan = suggestThemePlan(courses, { ...prefs, completedCourses: 'Public Writing' }, theme.id);
    for (const term of TERMS) {
      assert.ok(plan[term].reduce((sum, item) => sum + item.credits, 0) <= prefs.target);
      assert.ok(plan[term].every(item => !['b', 'c', 'd'].includes(item.id)));
    }
  }
});

test('excluded courses are omitted from generated themes', () => {
  const courses = [
    makeCourse('a', 'Community Law', 16, [], { type: 'Program' }),
    makeCourse('b', 'Public Writing', 4, []),
  ];
  const plan = suggestThemePlan(courses, { ...prefs, excludedCourseIds: ['a'] }, 'core');
  assert.ok(plan.Fall.every(item => item.id !== 'a'));
  assert.ok(plan.Fall.some(item => item.id === 'b'));
});

test('theme changes keep Yes for me courses and build around their meeting times', () => {
  const pinned = makeCourse('pinned', 'Civic Writing', 4, [meeting('Tue', 600, 720)]);
  const compatible = makeCourse('compatible', 'Community Law', 8, [meeting('Wed', 600, 720)]);
  const clash = makeCourse('clash', 'Legal Writing', 8, [meeting('Tue', 660, 780)]);
  const existing = { Fall: [{ id: 'pinned', credits: 4, pinned: true }, { id: 'clash', credits: 8 }], Winter: [], Spring: [] };
  const updated = suggestThemePlan([pinned, compatible, clash], { ...prefs, target: 12 }, 'breadth', existing);
  assert.deepEqual(updated.Fall, [{ id: 'pinned', credits: 4, pinned: true }, { id: 'compatible', credits: 8 }]);
  assert.equal(existing.Fall[1].id, 'clash');
});

test('New spin changes a quarter while keeping pinned courses and respecting constraints', () => {
  const pinned = makeCourse('pinned', 'Civic Writing', 4, [meeting('Tue', 600, 720)]);
  const old = makeCourse('old', 'Legal History', 8, [meeting('Mon', 600, 720)]);
  const alternative = makeCourse('alternative', 'Public Policy Workshop', 8, [meeting('Wed', 600, 720)]);
  const clash = makeCourse('clash', 'Writing Lab', 8, [meeting('Tue', 660, 780)]);
  const completed = makeCourse('completed', 'Psychology Seminar', 8, [meeting('Thu', 600, 720)]);
  const remote = makeCourse('remote', 'Public Service', 8, [], { modes: { Fall: 'Remote' } });
  const courses = [pinned, old, alternative, clash, completed, remote];
  const plan = { Fall: [{ id: 'pinned', credits: 4, pinned: true }, { id: 'old', credits: 8 }], Winter: [], Spring: [] };
  const spun = spinQuarterPlan(courses, { ...prefs, target: 12, completedCourses: 'Psychology Seminar' }, plan, 'Fall', 'core');
  assert.deepEqual(spun, [{ id: 'pinned', credits: 4, pinned: true }, { id: 'alternative', credits: 8 }]);
  assert.deepEqual(plan.Fall, [{ id: 'pinned', credits: 4, pinned: true }, { id: 'old', credits: 8 }]);
});

test('successive spins explore several credit mixes around a pinned four-credit course', () => {
  const courses = [
    makeCourse('pinned', 'Policy Writing', 4, [meeting('Mon', 600, 720)]),
    makeCourse('large', 'Civic Law', 16, [meeting('Tue', 600, 720)], { type: 'Program' }),
    makeCourse('twelve', 'Politics and Public Service', 12, [meeting('Wed', 600, 720)]),
    makeCourse('eight-a', 'Legal History', 8, [meeting('Thu', 600, 720)]),
    makeCourse('eight-b', 'Community Advocacy', 8, [meeting('Fri', 600, 720)]),
    makeCourse('four-a', 'Literature Seminar', 4, [meeting('Tue', 900, 1020)]),
    makeCourse('four-b', 'Music Workshop', 4, [meeting('Wed', 900, 1020)]),
    makeCourse('four-c', 'Civic Research', 4, [meeting('Thu', 900, 1020)]),
    makeCourse('four-d', 'Creative Writing', 4, [meeting('Fri', 900, 1020)]),
    makeCourse('clash', 'Law and Politics', 8, [meeting('Mon', 660, 780)]),
  ];
  let plan = { Fall: [{ id: 'pinned', credits: 4, pinned: true }, { id: 'large', credits: 16 }], Winter: [], Spring: [] };
  const expected = [[8, 8], [4, 4, 8], [4, 4, 4, 4], [4, 12], [16]];
  for (let spin = 0; spin < expected.length; spin++) {
    plan = { ...plan, Fall: spinQuarterPlan(courses, prefs, plan, 'Fall', 'core', spin) };
    assert.deepEqual(plan.Fall.filter(item => !item.pinned).map(item => item.credits).sort((a, b) => a - b), expected[spin]);
    assert.deepEqual(plan.Fall.find(item => item.id === 'pinned'), { id: 'pinned', credits: 4, pinned: true });
    assert.equal(plan.Fall.reduce((sum, item) => sum + item.credits, 0), 20);
    assert.ok(!plan.Fall.some(item => item.id === 'clash'));
    for (let i = 0; i < plan.Fall.length; i++) for (let j = i + 1; j < plan.Fall.length; j++) {
      assert.equal(courseConflict(courses.find(course => course.id === plan.Fall[i].id), courses.find(course => course.id === plan.Fall[j].id), 'Fall'), false);
    }
  }
});

test('disliked academic fields lower ranking without hiding courses', () => {
  const math = makeCourse('math', 'Civic Mathematics', 16, [], { type: 'Program', fields: ['Mathematics'] });
  const literature = makeCourse('lit', 'Civic Literature', 16, [], { type: 'Program', fields: ['Literature'] });
  const preferences = { ...prefs, target: 16, academicFocus: 'civic', careerGoals: '', dislikedFields: 'math' };
  assert.ok(courseRelevance(math, preferences) < courseRelevance(math, { ...preferences, dislikedFields: '' }));
  assert.ok(courseRelevance(literature, preferences) > courseRelevance(math, preferences));
  assert.equal(suggestThemePlan([math, literature], preferences, 'core').Fall[0]?.id, 'lit');
  assert.equal(suggestThemePlan([math], preferences, 'core').Fall[0]?.id, 'math');
  const replacements = replacementSuggestions([math, literature], preferences, { Fall: [], Winter: [], Spring: [] }, 'Fall', { id: 'old', credits: 16 });
  assert.equal(replacements[0]?.course.id, 'lit');
  assert.ok(replacements.some(item => item.course.id === 'math'));
});

test('completed titles match conservatively and do not conflate course sequences', () => {
  assert.equal(courseAlreadyTaken(makeCourse('x','Introduction to Psychology',4,[]), 'Intro to Psych'), true);
  assert.equal(courseAlreadyTaken(makeCourse('y','Statistics II',4,[]), 'Statistics I'), false);
  assert.equal(courseAlreadyTaken(makeCourse('z','The U.S. Supreme Court',4,[]), 'The U.S. Supreme Court'), true);
});

test('replacement suggestions respect quarter, formats, conflicts, prior classes, and show larger credits', () => {
  const selected = makeCourse('a','Current Course',4,[meeting('Mon',600,720)]);
  const good = makeCourse('b','Public Policy Workshop',8,[meeting('Tue',600,720)]);
  const large = makeCourse('c','Law and Society',16,[meeting('Wed',600,720)],{type:'Program'});
  const clash = makeCourse('d','Legal Writing',4,[meeting('Mon',650,750)]);
  const completed = makeCourse('e','Introduction to Psychology',4,[meeting('Thu',600,720)]);
  const winter = makeCourse('f','Winter Policy',4,[],{offerings:{Winter:{status:'Open'}},modes:{Winter:'In person'}});
  const plan = {Fall:[{id:'a',credits:4}],Winter:[],Spring:[]};
  const found = replacementSuggestions([selected,good,large,clash,completed,winter],{...prefs,target:4,completedCourses:'Intro to Psych'},plan,'Fall',{id:'old',credits:4});
  assert.ok(found.some(item=>item.course.id==='b'));
  assert.ok(found.some(item=>item.course.id==='c'));
  assert.ok(found.every(item=>!['a','d','e','f'].includes(item.course.id)));
  const filtered = replacementSuggestions([selected,good,large,clash,completed,winter],{...prefs,target:4,completedCourses:'Intro to Psych',excludedCourseIds:['b']},plan,'Fall',{id:'old',credits:4});
  assert.ok(filtered.every(item => item.course.id !== 'b'));
});

test('replacement suggestions prioritize the remaining credit gap and relevant interests', () => {
  const courses = [
    makeCourse('exact-relevant', 'Civic Writing', 8, []),
    makeCourse('near-relevant', 'Legal Writing', 4, []),
    makeCourse('exact-unrelated', 'Botany', 8, []),
    makeCourse('far-relevant', 'Law and Society', 16, []),
    makeCourse('far-unrelated', 'Ecology', 16, []),
    makeCourse('flexible', 'Public Policy', 4, [], { credits: [4, 8] }),
  ];
  const plan = { Fall: [{ id: 'existing', credits: 12 }], Winter: [], Spring: [] };
  const found = replacementSuggestions(courses, prefs, plan, 'Fall', { id: 'removed', credits: 4 }, 'custom', 20);
  assert.equal(found.find(item => item.course.id === 'flexible').credits, 8);
  assert.ok(found.findIndex(item => item.course.id === 'exact-relevant') < found.findIndex(item => item.course.id === 'exact-unrelated'));
  assert.ok(found.findIndex(item => item.course.id === 'near-relevant') < found.findIndex(item => item.course.id === 'far-relevant'));
  assert.ok(found.findIndex(item => item.course.id === 'exact-unrelated') < found.findIndex(item => item.course.id === 'far-unrelated'));
  assert.match(found[0].reason, /credit|target/);
});

test('published catalog has unique, linked undergraduate offerings', () => {
  const manifest = JSON.parse(readFileSync(new URL('../data/manifest.json', import.meta.url)));
  const latest = manifest.catalogs[0];
  const snapshot = JSON.parse(readFileSync(new URL(`../data/${latest.file}`, import.meta.url)));
  assert.equal(snapshot.academicYear, latest.academicYear);
  assert.ok(snapshot.courses.length >= 400);
  assert.equal(new Set(snapshot.courses.map(course => course.id)).size, snapshot.courses.length);
  assert.ok(snapshot.courses.every(course => course.url.startsWith('https://www.evergreen.edu/catalog/offering/')));
  if (snapshot.academicYear === '2026-27') {
    assert.ok(snapshot.courses.some(course => /Street Level Democracy/.test(course.title)));
    assert.ok(snapshot.courses.some(course => /Supreme Court/.test(course.title)));
  }
});
