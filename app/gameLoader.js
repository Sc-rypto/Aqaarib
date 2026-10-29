/**
 * Unified Game Loader & Registry
 * /app/gameLoader.js
 *
 * Provides all 5 family games conforming to the frozen Browser Game Module Interface.
 */

import busCountModule from '../games/bus_count.js';
import reportGamesModule from '../games/report_games.js';
import { redLightModule, hotPotatoModule } from './adapters/personBAdapter.js';
import { GAME_CATALOG } from '../data/gameCatalog.js';

const registry = {
  bus_count: busCountModule,
  red_light: redLightModule,
  hot_potato: hotPotatoModule,
  report_games: reportGamesModule,
  balloon: {
    ...reportGamesModule,
    id: 'balloon',
    title: 'Balloon Keep Up',
    rulesText: GAME_CATALOG.find((g) => g.id === 'balloon')?.rulesText || reportGamesModule.rulesText,
    defaultRules: { targetGame: 'balloon', judgeKey: '' }
  },
  football: {
    ...reportGamesModule,
    id: 'football',
    title: 'Penalty Shootout',
    rulesText: GAME_CATALOG.find((g) => g.id === 'football')?.rulesText || reportGamesModule.rulesText,
    defaultRules: { targetGame: 'football', judgeKey: '' }
  }
};

export function getGameModule(id) {
  return registry[id] || null;
}

export function listAvailableGames() {
  return GAME_CATALOG;
}
