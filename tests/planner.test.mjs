import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { courseConflict, offeringAvailable, planIssues, suggestedPaths, TERMS } from '../planner.js';

const meeting = (day, start, end, weeks = [1, 2, 3]) => ({ day, start, end, weeks });
const makeCourse = (id, title, credits, meetings, extra = {}) => ({
  id, title, type: 'Course', fields: [], description: '', credits: [credits],
  standings: ['Sophomore'], modes: { Fall: 'In person' },
  offerings: { Fall: { status: 'Open' } }, meetings: { Fall: meetings },
  location: 'Olympia', ...extra,
});
const prefs = { standing: 'Sophomore', target: 20, location: 'Olympia', formats: ['In person', 'Hybrid'], interests: ['law'] };

test('availability respects standing, mode, campus, credit target, and closed status', () => {
  const course = makeCourse('a', 'Constitutional Law', 8, []);
  assert.equal(offeringAvailable(course, 'Fall', prefs), true);
  assert.equal(offeringAvailable(course, 'Winter', prefs), false);
  assert.equal(offeringAvailable(course, 'Fall', { ...prefs, standing: 'Freshman' }), false);
  assert.equal(offeringAvailable(course, 'Fall', { ...prefs, target: 4 }), false);
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

test('path suggestions avoid special-entry courses and fit each quarter', () => {
  const courses = [
    makeCourse('a', 'Community Law', 16, [meeting('Mon', 600, 720)], { type: 'Program' }),
    makeCourse('b', 'Public Writing', 4, [meeting('Tue', 600, 720)]),
    makeCourse('c', 'Advanced Constitutional Law', 4, [meeting('Wed', 600, 720)], { prerequisites: 'One year of law study' }),
    makeCourse('d', 'Prior Learning from Experience Preparatory', 4, [meeting('Thu', 600, 720)]),
  ];
  const paths = suggestedPaths(courses, prefs);
  assert.equal(paths.length, 3);
  for (const path of paths) for (const term of TERMS) {
    assert.ok(path.plan[term].reduce((sum, item) => sum + item.credits, 0) <= prefs.target);
    assert.ok(path.plan[term].every(item => !['c', 'd'].includes(item.id)));
  }
});

test('published catalog has unique, linked undergraduate offerings', () => {
  const snapshot = JSON.parse(readFileSync(new URL('../data/catalog-2026-27.json', import.meta.url)));
  assert.ok(snapshot.courses.length >= 400);
  assert.equal(new Set(snapshot.courses.map(course => course.id)).size, snapshot.courses.length);
  assert.ok(snapshot.courses.every(course => course.url.startsWith('https://www.evergreen.edu/catalog/offering/')));
  assert.ok(snapshot.courses.some(course => /Street Level Democracy/.test(course.title)));
  assert.ok(snapshot.courses.some(course => /Supreme Court/.test(course.title)));
});
