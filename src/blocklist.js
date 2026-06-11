// ME COIN — public-figure name blocklist.
// A normalized match means the mint needs manual verification (we don't
// auto-approve cards claiming to be people the whole internet knows).
// Zero dependencies; names stored lowercase with non-alphanumerics stripped.

const BLOCKED = new Set([
  // politics & heads of state
  'donaldtrump', 'joebiden', 'barackobama', 'kamalaharris', 'hillaryclinton',
  'billclinton', 'georgebush', 'georgewbush', 'ronaldreagan', 'abrahamlincoln',
  'georgewashington', 'vladimirputin', 'volodymyrzelensky', 'xijinping',
  'narendramodi', 'emmanuelmacron', 'justintrudeau', 'borisjohnson',
  'rishisunak', 'keirstarmer', 'angelamerkel', 'olafscholz', 'giorgiameloni',
  'benjaminnetanyahu', 'mohammedbinsalman', 'kimjongun', 'popefrancis',
  'berniesanders', 'elizabethwarren', 'nancypelosi', 'mitchmcconnell',
  'rondesantis', 'gavinnewsom', 'alexandriaocasiocortez', 'jdvance',
  'barrontrump', 'melaniatrump', 'michelleobama',
  // royals
  'queenelizabeth', 'kingcharles', 'princewilliam', 'princeharry',
  'meghanmarkle', 'katemiddleton', 'princessdiana',
  // tech & business
  'elonmusk', 'jeffbezos', 'billgates', 'markzuckerberg', 'stevejobs',
  'warrenbuffett', 'samaltman', 'sundarpichai', 'satyanadella', 'timcook',
  'larrypage', 'sergeybrin', 'jackdorsey', 'paveldurov', 'vitalikbuterin',
  'changpengzhao', 'sambankmanfried', 'michaelsaylor', 'cathiewood',
  'jeromepowell', 'janetyellen', 'oprahwinfrey', 'marthastewart',
  // music
  'taylorswift', 'kanyewest', 'beyonce', 'rihanna', 'drake', 'justinbieber',
  'arianagrande', 'selenagomez', 'eminem', 'jayz', 'snoopdogg', 'drdre',
  'kendricklamar', 'travisscott', 'postmalone', 'edsheeran', 'adele',
  'ladygaga', 'britneyspears', 'madonna', 'brunomars', 'theweeknd',
  'billieeilish', 'oliviarodrigo', 'dualipa', 'harrystyles', 'shakira',
  'jenniferlopez', 'nickiminaj', 'cardib', 'dojacat', 'sza', 'badbunny',
  'michaeljackson', 'elvispresley', 'johnlennon', 'paulmccartney',
  'frankocean', 'lilwayne', 'lilnasx', 'icecube', 'tupacshakur',
  'notoriousbig', 'sabrinacarpenter', 'chappellroan',
  // film & tv
  'tomcruise', 'bradpitt', 'angelinajolie', 'leonardodicaprio',
  'jenniferlawrence', 'emmawatson', 'dwaynejohnson', 'keanureeves',
  'robertdowneyjr', 'chrishemsworth', 'chrisevans', 'scarlettjohansson',
  'margotrobbie', 'zendaya', 'timotheechalamet', 'ryangosling',
  'ryanreynolds', 'hughjackman', 'willsmith', 'denzelwashington',
  'morganfreeman', 'samuelljackson', 'harrisonford', 'galgadot',
  'jasonmomoa', 'vindiesel', 'johnnydepp', 'meganfox', 'sydneysweeney',
  'pedropascal', 'adamdriver', 'adamsandler', 'jimcarrey', 'eddiemurphy',
  'chrisrock', 'kevinhart', 'davechappelle', 'jerryseinfeld', 'larrydavid',
  'marilynmonroe', 'tomhanks', 'merylstreep', 'anyataylorjoy',
  'jennaortega', 'florencepugh', 'austinbutler', 'jacobelordi',
  // tv hosts & media
  'jimmyfallon', 'jimmykimmel', 'stephencolbert', 'conanobrien',
  'ellendegeneres', 'trevornoah', 'johnoliver', 'howardstern',
  'joerogan', 'benshapiro', 'jordanpeterson', 'tuckercarlson',
  'andersoncooper', 'gordonramsay', 'jamieoliver', 'davidattenborough',
  // sports
  'cristianoronaldo', 'lionelmessi', 'neymar', 'kylianmbappe',
  'erlinghaaland', 'zlatanibrahimovic', 'davidbeckham', 'lebronjames',
  'michaeljordan', 'kobebryant', 'shaquilleoneal', 'stephencurry',
  'kevindurant', 'giannisantetokounmpo', 'victorwembanyama', 'tombrady',
  'patrickmahomes', 'peytonmanning', 'traviskelce',
  'tigerwoods', 'serenawilliams', 'venuswilliams', 'rogerfederer',
  'rafaelnadal', 'novakdjokovic', 'carlosalcaraz', 'usainbolt',
  'simonebiles', 'miketyson', 'floydmayweather', 'conormcgregor',
  'muhammadali', 'waynegretzky', 'baberuth', 'shoheiohtani',
  'maxverstappen', 'lewishamilton', 'calebwilliams', 'caitlinclark',
  // internet & streamers
  'mrbeast', 'pewdiepie', 'kaicenat', 'ishowspeed', 'xqc', 'pokimane',
  'ninja', 'loganpaul', 'jakepaul', 'ksi', 'daviddobrik', 'charlidamelio',
  'addisonrae', 'khabylame', 'andrewtate', 'tristantate', 'adinross',
  'hasanabi', 'asmongold', 'valkyrae', 'sssniperwolf', 'markiplier',
  'jacksepticeye', 'kimkardashian', 'kyliejenner', 'kendalljenner',
  'krisjenner', 'khloekardashian', 'parishilton',
  // historical & misc public figures
  'alberteinstein', 'stephenhawking', 'isaacnewton', 'charlesdarwin',
  'nikolatesla', 'thomasedison', 'waltdisney', 'stanlee', 'bobross',
  'martinlutherking', 'nelsonmandela', 'mahatmagandhi', 'malalayousafzai',
  'gretathunberg', 'jkrowling', 'stephenking', 'georgerrmartin',
  'jesuschrist', 'dalailama',
]);

/** normalize: lowercase, strip everything that isn't a-z or 0-9. */
function normalizeName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isBlockedName(name) {
  return BLOCKED.has(normalizeName(name));
}
