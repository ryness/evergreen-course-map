import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { courseConflict, offeringAvailable, planIssues, TERMS } from '../planner.js';
import { THEMES, courseAlreadyTaken, courseRelevance, replacementSuggestions, suggestThemePlan } from '../recommend.js';

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

test('plan review flags credit overload and actual conflicts', () => {
  const a = makeCourse('a', 'Law and Society', 16, [meeting('Tue', 600, 720)]);
  const b = makeCourse('b', 'Civic Writing', 8, [meeting('Tue', 700, 760)]);
  const issues = planIssues({ Fall: [{ id: 'a', credits: 16 }, { id: 'b', credits: 8 }], Winter: [], Spring: [] }, [a, b], 20);
  assert.ok(issues.some(item => item.kind === 'over'));
  assert.ok(issues.some(item => item.kind === 'clash'));
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
