import { validateReport, createReport } from './stubs/report.js';

// Sample validation test run
const sampleReport = createReport({
  gameName: 'Red Light',
  sessionTimestamp: Date.now(),
  durationSec: 42.5,
  players: [
    { id: 'p1', name: 'Sara' },
    { id: 'p2', name: 'Omar' }
  ],
  scores: { p1: 3, p2: 1 },
  strikes: { p1: 0, p2: 2 },
  events: [
    { type: 'STRIKE', playerId: 'p2', playerName: 'Omar', reason: 'Omar moved on Red' },
    { type: 'FINISH', playerId: 'p1', playerName: 'Sara', reason: 'Sara crossed the finish line in 1st place' }
  ],
  evidence: [
    { id: 'ev_1', title: 'Finish Snapshot', reason: 'Sara crossed finish', imageUri: 'data:image/png;base64,...' }
  ]
});

const validation = validateReport(sampleReport);
if (validation.valid) {
  console.log('✅ Result object validation PASSED. Schema complies with frozen specification.');
  process.exit(0);
} else {
  console.error('❌ Result object validation FAILED:');
  validation.errors.forEach(err => console.error('  -', err));
  process.exit(1);
}
