// Identity stays official even after a project publishes a customized version.
export const officialSkillNames = Object.freeze([
  'office-character-studio',
  'office-space-designer',
  'announcement-designer',
  'wanwu-skills-sync',
  'wanwu-canvas',
]);
export const isOfficialSkill = name => officialSkillNames.includes(name);
