import type { Skill } from './types';

/** min/max players and typical length (minutes) used as form defaults. */
export const SPORTS = [
  { id: 'soccer', label: 'Soccer', emoji: '⚽', min: 8, max: 14, duration: 90 },
  { id: 'basketball', label: 'Basketball', emoji: '🏀', min: 6, max: 10, duration: 90 },
  { id: 'volleyball', label: 'Volleyball', emoji: '🏐', min: 4, max: 12, duration: 90 },
  { id: 'tennis', label: 'Tennis', emoji: '🎾', min: 2, max: 4, duration: 90 },
  { id: 'pickleball', label: 'Pickleball', emoji: '🏓', min: 4, max: 8, duration: 90 },
  { id: 'football', label: 'Flag football', emoji: '🏈', min: 8, max: 14, duration: 90 },
  { id: 'baseball', label: 'Baseball / softball', emoji: '⚾', min: 10, max: 20, duration: 120 },
  { id: 'ultimate', label: 'Ultimate frisbee', emoji: '🥏', min: 8, max: 16, duration: 90 },
  { id: 'cricket', label: 'Cricket', emoji: '🏏', min: 10, max: 22, duration: 180 },
  { id: 'hockey', label: 'Hockey', emoji: '🏒', min: 6, max: 14, duration: 90 },
  { id: 'badminton', label: 'Badminton', emoji: '🏸', min: 2, max: 8, duration: 90 },
  { id: 'running', label: 'Running', emoji: '🏃', min: 2, max: 30, duration: 60 },
  { id: 'other', label: 'Other', emoji: '🏅', min: 2, max: 12, duration: 90 },
] as const;

export function sportInfo(id: string) {
  return SPORTS.find((s) => s.id === id) ?? { id, label: id, emoji: '🏅', min: 2, max: 12, duration: 90 };
}

export const SKILLS: { id: Skill; label: string }[] = [
  { id: 'any', label: 'All levels' },
  { id: 'beginner', label: 'Beginner' },
  { id: 'intermediate', label: 'Intermediate' },
  { id: 'advanced', label: 'Advanced' },
];

export function skillLabel(id: Skill) {
  return SKILLS.find((s) => s.id === id)?.label ?? id;
}

export const RADIUS_OPTIONS = [5, 10, 25, 50];

/** How close players must be to the pin to check in. */
export const CHECKIN_AREAS = [
  { m: 150, label: 'Small — a court or single field (150 m)' },
  { m: 300, label: 'Medium — a sports complex (300 m)' },
  { m: 750, label: 'Large — a big park (750 m)' },
];
