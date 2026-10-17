// The original "TeamN_" index from the roster spreadsheet
// (Steps_Challenge_Team.xlsx) for every team, keyed by that team's CURRENT
// name in Firestore — not necessarily its name when this list was written.
// Shared by set-team-display-index.js (tags each team with its number) and
// check-roster.js (verifies nothing's missing against the full 34-team/
// 170-person roster this event expects).
//
// Keep this in sync whenever a team is renamed (rename-team.js) or a
// previously-TBD team gets a real name — the entry's key must always match
// that team's current `name` field, or both scripts stop recognizing it.
export const NAME_TO_INDEX = {
  AliensWalking: 1, ASCteam: 2, BEReadySetGo: 3, Beginnersluck: 4, BOBOGO: 5,
  BomberGirl: 6, Breakaleg: 7, CoffeeBlazer: 8, FeetFleet: 9, HeaWeGo: 10,
  Marunouchine: 11, MilesAhead: 12, OHSydneyTeam: 13, OhhWalkers: 14,
  OHttersWalkers: 15, OOE: 16, OtterlyOHmazing: 17,
  RedHotChilliSteppers: 18, RegionalWealthnessChampions: 19, Skywalker: 20,
  SoleMates: 21, SOWDhurandhar: 22, StepUpSquad: 23, Stepswithoutborders: 24,
  MaxWalkstappen: 25, TheGallopers: 26, MarketMovers: 27, TeamFSO: 28,
  TeamTaiwan: 29, TheStepHustlers: 30, TheWonderWalkers: 31, WAE: 32,
  Walkaholics: 33, WeThoughtthiswasOptional: 34
};
