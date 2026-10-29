/**
 * Game Catalog and Preset Definitions
 * /data/gameCatalog.js
 *
 * Rules text and descriptions written in a friendly human referee voice:
 * Short, plain, no jargon, no emojis, no dash characters used as punctuation.
 */

export const GAME_CATALOG = [
  {
    id: 'red_light',
    title: 'Red Light Green Light',
    tagline: 'Stay in your lane and freeze when the light turns red',
    mode: 'individual',
    minPlayers: 2,
    maxPlayers: 4,
    inputs: ['camera', 'video_file'],
    rulesText: [
      'Line up in your assigned floor lane.',
      'Walk forward when the light is green.',
      'Freeze completely when the light turns red.',
      'Three strikes for moving on red will set you out.',
      'The first player to reach the finish line wins.'
    ],
    defaultRules: {
      numLanes: 3,
      finishLineY: 0.80
    }
  },
  {
    id: 'hot_potato',
    title: 'Hot Potato Photo Freeze',
    tagline: 'Avoid the danger zone before the secret countdown ends',
    mode: 'individual',
    minPlayers: 2,
    maxPlayers: 8,
    inputs: ['camera', 'video_file'],
    rulesText: [
      'Listen to the accelerating audio beeps.',
      'In hide mode hide completely out of camera view.',
      'In zone mode stay clear of the danger rectangle.',
      'Each player safe from the photo catch earns one point.',
      'The player with the most points after three rounds wins.'
    ],
    defaultRules: {
      totalRounds: 3
    }
  },
  {
    id: 'bus_count',
    title: 'Bus Count',
    tagline: 'Board the family bus on green and avoid boarding fouls on red',
    mode: 'both',
    minPlayers: 2,
    maxPlayers: 8,
    inputs: ['camera', 'video_file'],
    rulesText: [
      'Step across the door line when the bus signal is green.',
      'Do not cross into the bus after the horn blows and doors close.',
      'Every passenger safely on board scores one point for their team.',
      'The team or player with the most safe passengers wins the ride.'
    ],
    defaultRules: {
      roundDurationSec: 25,
      doorLineX: 0.35,
      busZone: { x: 0.35, y: 0.15, w: 0.60, h: 0.75 },
      greenDurationSec: 6,
      redDurationSec: 4
    }
  },
  {
    id: 'balloon',
    title: 'Balloon Keep Up',
    tagline: 'Keep the balloon aloft with safe family volleys',
    mode: 'both',
    minPlayers: 1,
    maxPlayers: 8,
    inputs: ['report_file'],
    rulesText: [
      'Volley the balloon upward to keep it off the carpet.',
      'Every safe tap scores one point for your team.',
      'A floor touch ends the rally.',
      'Upload the signed referee report to verify match rulings.'
    ],
    defaultRules: {
      targetGame: 'balloon'
    }
  },
  {
    id: 'football',
    title: 'Penalty Shootout',
    tagline: 'Aim for the corners or make dramatic goalkeeper saves',
    mode: 'both',
    minPlayers: 2,
    maxPlayers: 8,
    inputs: ['report_file'],
    rulesText: [
      'Take turns shooting and defending the goal line.',
      'Shots that cross the goal threshold score one point.',
      'Goalkeeper blocks award one save point.',
      'Upload the signed referee report to verify the score.'
    ],
    defaultRules: {
      targetGame: 'football'
    }
  }
];
