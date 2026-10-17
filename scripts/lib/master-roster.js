// The full, confirmed 34-team/170-person roster for this event (from
// Steps_Challenge_Team.xlsx), keyed by each team's CURRENT name in
// Firestore. Captain is always the first name in each array. Used by
// check-roster.js to verify every expected person actually exists with the
// correct username — not just that team/member counts look right.
//
// Keep this in sync with lib/team-index-map.js (same team names) whenever a
// team is renamed or a person's name changes.
export const MASTER_ROSTER = {
  AliensWalking: ['Daphyn', 'Amanda', 'HaoYuan', 'Richard', 'Samson'],
  ASCteam: ['Allen', 'ChunYin', 'Louise', 'Nikki', 'Sharon'],
  BEReadySetGo: ['Joy', 'Jahnavi', 'JinHui', 'Polly', 'Valerie'],
  Beginnersluck: ['Anthony', 'Jess', 'Maydeline', 'Sharon', 'Tammy'],
  BOBOGO: ['Janice', 'Crystal', 'Hayley', 'Lowan', 'Yannes'],
  BomberGirl: ['Shigenobu', 'Chizuru', 'Haruna', 'Megumi', 'Yoshiko'],
  Breakaleg: ['JinYang', 'Benson', 'NatpreeyaMelissa', 'Shawn', 'Zhen'],
  CoffeeBlazer: ['Karen', 'Absalom', 'Andy', 'Jacqueline', 'Lynnet'],
  FeetFleet: ['Xin', 'Huiwen', 'Joan', 'KaHo', 'Qian'],
  HeaWeGo: ['Martina', 'Annie', 'HowardGh', 'Thomas', 'Yuki'],
  Marunouchine: ['Saho', 'Hiroko', 'Mengying', 'Nanae', 'Tomomi'],
  MilesAhead: ['Jeff', 'Cherlotte', 'Janice', 'Nicole', 'Ruby'],
  OHSydneyTeam: ['Sarah', 'Ashley', 'Astrid', 'Budiono', 'Harold'],
  OhhWalkers: ['Nikhil', 'Alankar', 'Milind', 'Patricia', 'Soujanya'],
  OHttersWalkers: ['Emily', 'JiaRong', 'Keita', 'Peter', 'William'],
  OOE: ['Cortney', 'Clinton', 'Dani', 'Dickson', 'Heinz'],
  OtterlyOHmazing: ['Vicky', 'Charlotte', 'Esther', 'NyashaDavid', 'William'],
  RedHotChilliSteppers: ['Mark', 'Cheryl', 'Dwayne', 'Eunice', 'Janice'],
  RegionalWealthnessChampions: ['Roger', 'Alan', 'Jonah', 'Shelby', 'YenLing'],
  Skywalker: ['Luke', 'Gloria', 'Jane', 'Rachel', 'Vanessa'],
  SoleMates: ['Kris', 'ClaraL', 'Corinna', 'Dave', 'Noelle'],
  SOWDhurandhar: ['Asmita', 'DipshinUmesh', 'Gausmohamad', 'Kartik', 'Mayur'],
  StepUpSquad: ['Kristie', 'Beatrice', 'Ivan', 'Mandy', 'Shirley'],
  Stepswithoutborders: ['Winnie', 'Khooshali', 'Maya', 'Ray', 'Supreetha'],
  MaxWalkstappen: ['Aniket', 'Jeslin', 'Katrina', 'MinWei', 'Samuel'],
  TheGallopers: ['Shane', 'Jack', 'Naomi', 'Tiere', 'Zhiyang'],
  MarketMovers: ['Sandy', 'Candy', 'Helen', 'JennyS', 'Maria'],
  TeamFSO: ['Katie', 'Jack', 'Oksana', 'Sandra', 'Sean'],
  TeamTaiwan: ['Frank', 'Anthony', 'Bancroft', 'Coco', 'Vincent'],
  TheStepHustlers: ['AnushkaAnil', 'Ashishkumar', 'Guruprasad', 'Hiren', 'Jeffy'],
  TheWonderWalkers: ['Sharon', 'Angie', 'Carolyn', 'Karis', 'Stephanie'],
  WAE: ['Yingxue', 'Aerilyn', 'Alicia', 'Amanda', 'WenYik'],
  Walkaholics: ['Celestine', 'Ariel', 'Brendan', 'CheeHow', 'Glenn'],
  WeThoughtthiswasOptional: ['Oscar', 'FangJiun', 'PakChen', 'Pandora', 'Winnie']
};
