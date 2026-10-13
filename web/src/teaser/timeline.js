// One timeline for picture and sound (LESSONS: every cut, hit and whoosh on the same sample).
// Times are in beats; sec(story, beats) converts. Imported by the edit page and by the node score.

export const STORIES = {
  city: {
    bpm: 96, beats: 24, fps: 60, world: 'city',
    // wt0 = world time at the start of each shot (seconds into the endless avenue; the cruiser runs ~40-58 s for seed 7)
    shots: [
      { from: 0, to: 10, world: 'city', wt0: 4 },        // golden-hour drive, phone comes up, buy
      { from: 10, to: 18, world: 'city', wt0: 42 }, // the cruiser closes in, buzz, ring, WASTED (time continues)
      { from: 18, to: 24, world: 'city', wt0: 63 }, // hard cut: another run, sell all, MISSION PASSED, end card
    ],
    cues: {
      peek: [1, 2.5],        // the phone already peeks at the bottom-right edge, island open with the bag's +%, buzzes on these beats
      raise: 4,              // the hand brings the phone up (lands on the downbeat)
      unlock: 6,             // lock -> pump (buzz)
      launch: 7.5,           // a launch slides in
      tap: 9,                // thumb taps buy
      buzz: 12,              // "$??? is dumping"
      rugstamp: 12.5,        // RUGGED slams onto the ??? row
      ring: 13,              // RUG ALERT, phone rings
      tapestop: 14,          // music tape-stops into...
      wasted: 15,            // WASTED slams
      cut2: 18,              // hard cut, another run
      sell: 19,              // thumb taps sell all
      passed: 19.5,          // MISSION PASSED
      endcard: 21.75,        // fade to the end card
    },
  },
  blocky: {
    bpm: 120, beats: 24, fps: 60, world: 'blocky',
    shots: [{ from: 0, to: 24, world: 'blocky', wt0: 2.5 }], // v2 walk: the lava ravine runs ~2-14 s
    cues: {
      letterbox: [0, 2],
      raise: 4,
      tap: 7,                // buy
      dip: 8,                // the bag dips -52%
      hiss: [9, 12],         // riser
      up: 12,                // back up +240%
      ach: 12.5,             // Achievement get!
      sell: 15.5,            // sell all
      passed: 16,            // MISSION PASSED
      endcard: 20.4,         // ~1.8 s end card
    },
  },
};

// v2 signature: "one phone. every game." Drum & bass at 172: rapid swaps through all six worlds, each with its own phone.
// shots: world + the phone skin + which plate; the hand puts one phone away and pulls the next up on every cut.
STORIES.games = {
  bpm: 172, beats: 37, fps: 60, world: 'blocky',
  shots: [
    { from: 0, to: 4, world: 'blocky', wt0: 4.6, skin: 'blocky', plate: 'pump', raiseAt: 0.75 },    // lead with blocky: buy tap + coin burst
    { from: 4, to: 6, world: 'toon', wt0: 39.3, skin: 'toon', plate: 'pump' },
    { from: 6, to: 8, world: 'tactical', wt0: 5.5, skin: 'tactical', plate: 'lock' },
    { from: 8, to: 10, world: 'obby', wt0: 5.6, skin: 'obby', plate: 'pump' },
    { from: 10, to: 12, world: 'survival', wt0: 39.4, skin: 'survival', plate: 'lock' },
    { from: 12, to: 14, world: 'city', wt0: 39.4, skin: 'city', plate: 'pump' },
    { from: 14, to: 22, world: 'blocky', wt0: 11.5, skin: 'blocky', plate: 'pump' },  // the hero world: RUGGED -> RUG ALERT -> WASTED
    { from: 22, to: 37, world: 'toon', wt0: 4.6, skin: 'toon', plate: 'win', stayUp: 30 }, // MISSION PASSED, then the end card
  ],
  cues: {
    tap: 2.25,             // buy tap + coin burst (blocky)
    drop: 4,               // montage starts
    rugstamp: 15.5,        // RUGGED lands on the ??? row (blocky)
    ring: 16.5,            // RUG ALERT
    tapestop: 17,          // music tape-stops into...
    wasted: 18,            // WASTED (blocky, pixel style)
    cut2: 22,              // toon: the bag is up
    sell: 23.25,           // sell all
    passed: 24,            // MISSION PASSED
    endcard: 30,           // BURNER · one phone. every game. · open source on github
  },
};

// v2.5: "type any amount". Club at 128, 15 s. Copycats fold, the keypad (typed on the 8ths), a buy; the pixel phone
// sells any % into MISSION PASSED; four hard cuts through the other worlds; the download card.
STORIES.any = {
  bpm: 128, beats: 32, fps: 60, world: 'city',
  shots: [
    { from: 0, to: 12, world: 'city', wt0: 6.2, skin: 'city', raiseAt: 0 },
    { from: 12, to: 21, world: 'blocky', wt0: 11.5, skin: 'blocky' },
    { from: 21, to: 22, world: 'toon', wt0: 39.3, skin: 'toon', plate: 'pump' },
    { from: 22, to: 23, world: 'tactical', wt0: 5.5, skin: 'tactical', plate: 'lock' },
    { from: 23, to: 24, world: 'obby', wt0: 5.6, skin: 'obby', plate: 'pump' },
    { from: 24, to: 25, world: 'survival', wt0: 39.4, skin: 'survival', plate: 'lock' },
    { from: 25, to: 32, world: 'city', wt0: 22, skin: 'city', stayUp: true },
  ],
  cues: {
    raise: 1,              // the phone lands: the New list, copycat bursts folded into one row each
    cap1: 2,               // COPYCATS? / ONE ROW. (second line half a beat later)
    rings: [2.5, 3],       // the ×13 lights up
    sizetap: 4,            // thumb taps the buy size: the keypad slides up, the phone comes closer
    keys: [5, 5.5, 6, 6.5], // 0 . 6 9
    cap2: 5,               // TYPE ANY / AMOUNT.
    go: 7,                 // "use 0.69 SOL"
    buy: 8,                // one tap: bought 0.69
    run: 9.5,              // "$Yoyo is running"
    focusOut: 7.35,        // the phone settles back before the buy (the island notes live at its top)
    cut2: 12,              // the pixel phone, the bag up 4x
    cap3: 13,              // SELL / ANY %
    anytap: 13,
    keys2: [14, 14.5],     // 5 0
    go2: 15,               // SELL 50%
    passed: 16,            // MISSION PASSED (pixel)
    cut3: 21,              // toon, tactical, obby, survival, one beat each
    cap4: 21,              // ONE PHONE. / EVERY GAME.
    endcard: 25,           // BURNERPHONE + download for windows
  },
};

export const spb = (s) => 60 / STORIES[s].bpm;
export const sec = (s, beats) => beats * spb(s);
export const dur = (s) => sec(s, STORIES[s].beats);
