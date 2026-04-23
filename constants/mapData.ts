/**
 * mapData.ts
 * Exact SVG pixel coordinates derived directly from annotator JSON polygons.
 * Formula: svgX = worldX_m / 0.11,  svgY = 524 - worldY_m / 0.11
 * Main floor viewBox: 1057 × 524   Squash floor viewBox: 560 × 430
 */

export interface MapPoint  { x: number; y: number }
export interface MapShape  { id: string; type: 'room' | 'corridor'; label: string; points: MapPoint[] }
export interface MapDoor   { id: string; x: number; y: number; isExit: boolean }
export interface MapBeacon { id: string; x: number; y: number; major: number; minor: number }
export interface NavNode   { id: string; x: number; y: number; neighbors: string[] }
export type FloorId = 'main' | 'squash';
export interface FloorData {
  id: FloorId; label: string; viewBoxW: number; viewBoxH: number;
  shapes: MapShape[]; doors: MapDoor[]; beacons: MapBeacon[];
  navGraph: NavNode[]; exits: MapDoor[];
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN FLOOR
// ═══════════════════════════════════════════════════════════════════════════
const MAIN_SHAPES: MapShape[] = [
  {id:"room_1",  type:"room",     label:"Room 1",       points:[{x:246,y:343},{x:318,y:342},{x:318,y:416},{x:246,y:416},{x:247,y:345}]},
  {id:"room_2",  type:"room",     label:"Room 2",       points:[{x:248,y:344},{x:174,y:342},{x:173,y:417},{x:246,y:416},{x:245,y:344}]},
  {id:"room_3",  type:"room",     label:"Room 3",       points:[{x:101,y:343},{x:173,y:342},{x:173,y:417},{x:101,y:416},{x:102,y:345}]},
  {id:"room_4",  type:"room",     label:"Room 4",       points:[{x:102,y:344},{x:28,y:342},{x:29,y:418},{x:101,y:416},{x:101,y:344}]},
  {id:"room_5",  type:"room",     label:"Room 5",       points:[{x:9,y:225},{x:0,y:342},{x:83,y:341},{x:81,y:224},{x:4,y:225}]},
  {id:"room_6",  type:"room",     label:"Room 6",       points:[{x:81,y:225},{x:203,y:225},{x:203,y:293},{x:81,y:292}]},
  {id:"room_7",  type:"room",     label:"Room 7",       points:[{x:220,y:224},{x:288,y:223},{x:288,y:306},{x:220,y:306}]},
  {id:"room_8",  type:"room",     label:"Room 8",       points:[{x:288,y:223},{x:342,y:223},{x:342,y:307},{x:289,y:305}]},
  {id:"room_9",  type:"room",     label:"Room 9",       points:[{x:342,y:222},{x:395,y:222},{x:396,y:208},{x:462,y:208},{x:461,y:307},{x:344,y:307}]},
  {id:"room_10", type:"room",     label:"Room 10",      points:[{x:496,y:209},{x:562,y:208},{x:560,y:235},{x:497,y:237}]},
  {id:"room_11", type:"room",     label:"Room 11",      points:[{x:349,y:54},{x:505,y:26},{x:522,y:125},{x:425,y:140},{x:428,y:162},{x:402,y:166},{x:396,y:144},{x:367,y:150}]},
  {id:"room_12", type:"room",     label:"Room 12",      points:[{x:368,y:150},{x:371,y:174},{x:400,y:167},{x:395,y:146}]},
  {id:"room_13", type:"room",     label:"Room 13",      points:[{x:496,y:236},{x:561,y:233},{x:589,y:258},{x:559,y:308},{x:496,y:308}]},
  {id:"room_14", type:"room",     label:"Room 14",      points:[{x:562,y:209},{x:606,y:241},{x:592,y:261},{x:563,y:236}]},
  {id:"room_15", type:"room",     label:"Room 15",      points:[{x:494,y:343},{x:561,y:343},{x:562,y:419},{x:493,y:415}]},
  {id:"room_16", type:"room",     label:"Room 16",      points:[{x:626,y:262},{x:683,y:305},{x:636,y:358},{x:585,y:319}]},
  {id:"room_17", type:"room",     label:"Room 17",      points:[{x:683,y:303},{x:737,y:347},{x:690,y:402},{x:636,y:360}]},
  {id:"room_18", type:"room",     label:"Room 18",      points:[{x:737,y:346},{x:785,y:383},{x:739,y:440},{x:694,y:403}]},
  {id:"room_19", type:"room",     label:"Room 19",      points:[{x:786,y:384},{x:831,y:418},{x:786,y:478},{x:742,y:441}]},
  {id:"room_20", type:"room",     label:"Room 20",      points:[{x:507,y:26},{x:625,y:1},{x:641,y:130},{x:588,y:136},{x:580,y:112},{x:522,y:122}]},
  {id:"room_21", type:"room",     label:"Gym",          points:[{x:806,y:74},{x:1041,y:266},{x:904,y:439},{x:671,y:252}]},
  {id:"room_22", type:"room",     label:"Room 22",      points:[{x:609,y:194},{x:665,y:185},{x:654,y:152},{x:603,y:158}]},
  {id:"corridor_1",     type:"corridor", label:"Corridor 1",    points:[{x:219,y:224},{x:203,y:225},{x:202,y:342},{x:220,y:342}]},
  {id:"corridor_2",     type:"corridor", label:"Corridor 2",    points:[{x:82,y:294},{x:203,y:294},{x:203,y:341},{x:83,y:340}]},
  {id:"corridor_3",     type:"corridor", label:"Corridor 3",    points:[{x:220,y:306},{x:318,y:306},{x:318,y:341},{x:221,y:342}]},
  {id:"corridor_4",     type:"corridor", label:"Corridor 4",    points:[{x:319,y:308},{x:494,y:308},{x:492,y:416},{x:318,y:415}]},
  {id:"corridor_5",     type:"corridor", label:"Corridor 5",    points:[{x:463,y:209},{x:494,y:208},{x:493,y:308},{x:463,y:307}]},
  {id:"corridor_6",     type:"corridor", label:"Corridor 6",    points:[{x:396,y:172},{x:429,y:162},{x:425,y:140},{x:581,y:115},{x:584,y:138},{x:643,y:130},{x:647,y:151},{x:601,y:158},{x:608,y:204},{x:587,y:225},{x:564,y:208},{x:396,y:207}]},
  {id:"corridor_7",     type:"corridor", label:"Corridor 7",    points:[{x:495,y:310},{x:560,y:307},{x:605,y:241},{x:626,y:261},{x:562,y:342},{x:499,y:341}]},
  {id:"corridor_large", type:"corridor", label:"Main Corridor", points:[{x:609,y:204},{x:908,y:441},{x:866,y:491},{x:810,y:445},{x:833,y:417},{x:588,y:226}]},
];

const MAIN_DOORS: MapDoor[] = [
  {id:"exit_door_1", x:362, y:133, isExit:true},
  {id:"exit_door_2", x:369, y:165, isExit:true},
  {id:"exit_door_4", x:394, y:194, isExit:true},
  {id:"exit_door_5", x:662, y:168, isExit:true},
  {id:"exit_door_6", x:898, y:453, isExit:true},
  {id:"exit_door_7", x:1033,y:280, isExit:true},
  {id:"exit_door_8", x:211, y:224, isExit:true},
];

const MAIN_BEACONS: MapBeacon[] = [
  {id:"beacon_1",  x:101,  y:379, major:2, minor:1 },
  {id:"beacon_2",  x:245,  y:379, major:2, minor:2 },
  {id:"beacon_3",  x:209,  y:283, major:2, minor:3 },
  {id:"beacon_4",  x:492,  y:360, major:2, minor:4 },
  {id:"beacon_5",  x:492,  y:416, major:2, minor:5 },
  {id:"beacon_6",  x:609,  y:204, major:2, minor:6 },
  {id:"beacon_7",  x:855,  y:260, major:2, minor:7 },
  {id:"beacon_8",  x:406,  y:262, major:2, minor:8 },
  {id:"beacon_9",  x:1033, y:280, major:2, minor:9 },
  {id:"beacon_10", x:609,  y:194, major:2, minor:10},
  {id:"beacon_11", x:318,  y:265, major:2, minor:11},
];

const MAIN_NAV: NavNode[] = [
  // Bottom strip rooms → corridor_2
  {id:"n_r1",    x:282, y:379, neighbors:["n_r2","n_c4w"]},
  {id:"n_r2",    x:209, y:379, neighbors:["n_r1","n_r3","n_c2e"]},
  {id:"n_r3",    x:136, y:379, neighbors:["n_r2","n_r4","n_c2w"]},
  {id:"n_r4",    x:64,  y:379, neighbors:["n_r3","n_c2w"]},
  {id:"n_r5",    x:45,  y:283, neighbors:["n_c2w"]},
  {id:"n_r6",    x:136, y:260, neighbors:["n_c2w","n_c2e"]},
  // Corridor 2
  {id:"n_c2w",   x:82,  y:318, neighbors:["n_r3","n_r4","n_r5","n_r6","n_c2e"]},
  {id:"n_c2e",   x:203, y:318, neighbors:["n_c2w","n_r2","n_r6","n_c1","n_c3"]},
  // Corridor 1 + Exit 8
  {id:"n_c1",    x:211, y:283, neighbors:["n_c2e","n_exit8","n_c3"]},
  {id:"n_exit8", x:211, y:224, neighbors:["n_c1"]},
  // Rooms 7, 8
  {id:"n_r7",    x:254, y:265, neighbors:["n_c2e","n_c3"]},
  {id:"n_r8",    x:315, y:265, neighbors:["n_c3","n_c4w"]},
  // Corridor 3
  {id:"n_c3",    x:269, y:324, neighbors:["n_c2e","n_r7","n_r8","n_c4w","n_c1"]},
  // Corridor 4 (backbone)
  {id:"n_c4w",   x:350, y:362, neighbors:["n_c3","n_r1","n_r8","n_c4m","n_r11","n_exit1","n_exit2"]},
  {id:"n_c4m",   x:406, y:362, neighbors:["n_c4w","n_c4e","n_r9","n_exit4"]},
  {id:"n_c4e",   x:478, y:362, neighbors:["n_c4m","n_c5","n_r15"]},
  {id:"n_r9",    x:400, y:260, neighbors:["n_c4m","n_c5"]},
  // Corridor 5
  {id:"n_c5",    x:478, y:258, neighbors:["n_c4e","n_r9","n_r10","n_c7","n_r13"]},
  // Exits 1,2,4
  {id:"n_exit1", x:362, y:133, neighbors:["n_c4w"]},
  {id:"n_exit2", x:369, y:165, neighbors:["n_c4w"]},
  {id:"n_exit4", x:394, y:194, neighbors:["n_c4m"]},
  // Corridor 6 (upper diagonal)
  {id:"n_c6a",   x:425, y:150, neighbors:["n_c4w","n_r11","n_c6b"]},
  {id:"n_c6b",   x:590, y:122, neighbors:["n_c6a","n_r20","n_rm"]},
  {id:"n_r11",   x:427, y:110, neighbors:["n_c4w","n_c6a"]},
  {id:"n_r20",   x:560, y:68,  neighbors:["n_c6b","n_rm"]},
  // Rooms 10,13,14,15
  {id:"n_r10",   x:527, y:222, neighbors:["n_c5","n_r13"]},
  {id:"n_r13",   x:527, y:272, neighbors:["n_r10","n_c5","n_r14"]},
  {id:"n_r14",   x:584, y:251, neighbors:["n_r13","n_rm"]},
  {id:"n_r15",   x:527, y:381, neighbors:["n_c4e","n_c7"]},
  // Corridor 7
  {id:"n_c7",    x:527, y:325, neighbors:["n_c5","n_r15","n_rm"]},
  // Main corridor junction
  {id:"n_rm",    x:609, y:213, neighbors:["n_c7","n_r14","n_c6b","n_r20","n_r22","n_exit5","n_r16"]},
  {id:"n_r22",   x:635, y:173, neighbors:["n_rm","n_exit5"]},
  {id:"n_exit5", x:662, y:168, neighbors:["n_rm","n_r22"]},
  // Diagonal chain rooms 16-19 → gym
  {id:"n_r16",   x:636, y:310, neighbors:["n_rm","n_r17"]},
  {id:"n_r17",   x:690, y:352, neighbors:["n_r16","n_r18"]},
  {id:"n_r18",   x:740, y:395, neighbors:["n_r17","n_r19"]},
  {id:"n_r19",   x:786, y:438, neighbors:["n_r18","n_gym"]},
  {id:"n_gym",   x:855, y:260, neighbors:["n_r19","n_exit6","n_exit7"]},
  {id:"n_exit6", x:898, y:453, neighbors:["n_gym"]},
  {id:"n_exit7", x:1033,y:280, neighbors:["n_gym"]},
];

// ═══════════════════════════════════════════════════════════════════════════
// SQUASH FLOOR
// ═══════════════════════════════════════════════════════════════════════════
const SQUASH_SHAPES: MapShape[] = [
  {id:"sq_room_1",     type:"room",     label:"Room 1",     points:[{x:4,y:221},{x:2,y:336},{x:81,y:336},{x:81,y:219}]},
  {id:"sq_room_2",     type:"room",     label:"Room 2",     points:[{x:28,y:335},{x:27,y:407},{x:81,y:407},{x:80,y:335}]},
  {id:"sq_room_3",     type:"room",     label:"Room 3",     points:[{x:82,y:221},{x:177,y:220},{x:176,y:286},{x:81,y:285}]},
  {id:"sq_room_4",     type:"room",     label:"Room 4",     points:[{x:82,y:286},{x:81,y:347},{x:176,y:346},{x:176,y:285}]},
  {id:"sq_room_5",     type:"room",     label:"Room 5",     points:[{x:81,y:348},{x:81,y:408},{x:108,y:407},{x:107,y:345}]},
  {id:"sq_room_6",     type:"room",     label:"Room 6",     points:[{x:218,y:220},{x:218,y:285},{x:314,y:284},{x:313,y:220}]},
  {id:"sq_room_7",     type:"room",     label:"Room 7",     points:[{x:219,y:285},{x:218,y:346},{x:312,y:345},{x:313,y:283}]},
  {id:"sq_room_8",     type:"room",     label:"Room 8",     points:[{x:314,y:221},{x:371,y:220},{x:371,y:280},{x:313,y:279}]},
  {id:"sq_room_9",     type:"room",     label:"Room 9",     points:[{x:372,y:221},{x:527,y:220},{x:525,y:278},{x:372,y:279}]},
  {id:"sq_room_10",    type:"room",     label:"Room 10",    points:[{x:314,y:280},{x:313,y:358},{x:401,y:357},{x:400,y:277}]},
  {id:"sq_room_11",    type:"room",     label:"Room 11",    points:[{x:401,y:278},{x:401,y:299},{x:431,y:299},{x:432,y:279}]},
  {id:"sq_room_12",    type:"room",     label:"Room 12",    points:[{x:401,y:299},{x:401,y:322},{x:431,y:321},{x:430,y:299}]},
  {id:"sq_room_13",    type:"room",     label:"Room 13",    points:[{x:401,y:322},{x:401,y:358},{x:430,y:358},{x:431,y:321}]},
  {id:"sq_room_14",    type:"room",     label:"Room 14",    points:[{x:432,y:279},{x:551,y:278},{x:550,y:358},{x:432,y:358}]},
  {id:"sq_room_15",    type:"room",     label:"Room 15",    points:[{x:476,y:360},{x:476,y:405},{x:551,y:404},{x:551,y:358}]},
  {id:"sq_room_16",    type:"room",     label:"Room 16",    points:[{x:526,y:221},{x:550,y:220},{x:551,y:279},{x:526,y:277}]},
  {id:"sq_corridor_1", type:"corridor", label:"Corridor 1", points:[{x:177,y:221},{x:176,y:346},{x:218,y:345},{x:218,y:220}]},
  {id:"sq_corridor_2", type:"corridor", label:"Corridor 2", points:[{x:108,y:347},{x:108,y:408},{x:313,y:407},{x:313,y:346}]},
  {id:"sq_corridor_3", type:"corridor", label:"Corridor 3", points:[{x:314,y:359},{x:475,y:358},{x:475,y:405},{x:314,y:404}]},
];

const SQUASH_DOORS: MapDoor[] = [
  {id:"sq_exit_3", x:56,  y:408, isExit:true},
  {id:"sq_exit_4", x:199, y:409, isExit:true},
  {id:"sq_exit_5", x:444, y:406, isExit:true},
];

const SQUASH_BEACONS: MapBeacon[] = [
  {id:"beacon_16", x:81,  y:320, major:1, minor:1},
  {id:"beacon_17", x:197, y:283, major:1, minor:2},
  {id:"beacon_18", x:343, y:250, major:1, minor:3},
  {id:"beacon_19", x:476, y:249, major:1, minor:4},
  {id:"beacon_20", x:491, y:382, major:1, minor:5},
];

const SQUASH_NAV: NavNode[] = [
  {id:"sq_r1",    x:42,  y:278, neighbors:["sq_c2w","sq_exit3"]},
  {id:"sq_r2",    x:54,  y:371, neighbors:["sq_r1","sq_exit3"]},
  {id:"sq_exit3", x:56,  y:408, neighbors:["sq_r2","sq_r1"]},
  {id:"sq_r5",    x:95,  y:376, neighbors:["sq_c2w"]},
  {id:"sq_c2w",   x:108, y:377, neighbors:["sq_r1","sq_r5","sq_c2m","sq_exit4"]},
  {id:"sq_exit4", x:199, y:409, neighbors:["sq_c2w","sq_c1"]},
  {id:"sq_c1",    x:197, y:283, neighbors:["sq_c2w","sq_exit4","sq_c2m","sq_r3","sq_r4","sq_r6","sq_r7"]},
  {id:"sq_r3",    x:129, y:253, neighbors:["sq_c1","sq_c2w"]},
  {id:"sq_r4",    x:129, y:316, neighbors:["sq_c1"]},
  {id:"sq_r6",    x:266, y:252, neighbors:["sq_c1","sq_c2m"]},
  {id:"sq_r7",    x:266, y:315, neighbors:["sq_c1","sq_c2m"]},
  {id:"sq_c2m",   x:313, y:376, neighbors:["sq_c1","sq_r6","sq_r7","sq_c3n","sq_r8","sq_r10"]},
  {id:"sq_r8",    x:342, y:250, neighbors:["sq_c2m","sq_c3"]},
  {id:"sq_r10",   x:357, y:318, neighbors:["sq_c2m","sq_c3n"]},
  {id:"sq_c3",    x:430, y:249, neighbors:["sq_c2m","sq_r8","sq_r11","sq_r12","sq_r13","sq_r14","sq_r9","sq_r16"]},
  {id:"sq_c3n",   x:400, y:382, neighbors:["sq_c2m","sq_r10","sq_exit5"]},
  {id:"sq_r9",    x:449, y:249, neighbors:["sq_c3","sq_r14"]},
  {id:"sq_r11",   x:416, y:288, neighbors:["sq_c3"]},
  {id:"sq_r12",   x:416, y:310, neighbors:["sq_c3"]},
  {id:"sq_r13",   x:416, y:340, neighbors:["sq_c3"]},
  {id:"sq_r14",   x:491, y:318, neighbors:["sq_c3","sq_r9","sq_r15","sq_r16","sq_exit5"]},
  {id:"sq_r15",   x:513, y:382, neighbors:["sq_r14","sq_exit5"]},
  {id:"sq_r16",   x:538, y:249, neighbors:["sq_c3","sq_r14"]},
  {id:"sq_exit5", x:444, y:406, neighbors:["sq_r14","sq_r15","sq_c3n"]},
];

export const ZONE_TO_NODES: Record<string, string[]> = {
  room_5:         ["n_r5","n_c2w"],
  room_6:         ["n_r6","n_c2w","n_c2e"],
  corridor_2:     ["n_c2w","n_c2e"],
  corridor_3:     ["n_c3"],
  corridor_4:     ["n_c4w","n_c4m","n_c4e"],
  corridor_5:     ["n_c5"],
  corridor_6:     ["n_c6a","n_c6b"],
  corridor_7:     ["n_c7","n_rm"],
  corridor_large: ["n_rm","n_gym"],
  room_7:         ["n_r7"],
  room_8:         ["n_r8"],
  room_9:         ["n_r9"],
  room_11:        ["n_r11","n_c6a"],
  room_21:        ["n_gym"],
  room_16:        ["n_r16"],
  room_17:        ["n_r17"],
  room_18:        ["n_r18"],
  room_19:        ["n_r19"],
  sq_corridor_1:  ["sq_c1","sq_exit4"],
  sq_corridor_2:  ["sq_c2w","sq_c2m"],
  sq_corridor_3:  ["sq_c3n","sq_exit5"],
  sq_room_9:      ["sq_r9","sq_c3"],
  sq_room_14:     ["sq_r14","sq_exit5"],
};

export const MAIN_FLOOR: FloorData = {
  id:"main", label:"Main Floor", viewBoxW:1057, viewBoxH:524,
  shapes:MAIN_SHAPES, doors:MAIN_DOORS, beacons:MAIN_BEACONS,
  navGraph:MAIN_NAV, exits:MAIN_DOORS.filter(d=>d.isExit),
};

export const SQUASH_FLOOR: FloorData = {
  id:"squash", label:"Squash Floor", viewBoxW:560, viewBoxH:430,
  shapes:SQUASH_SHAPES, doors:SQUASH_DOORS, beacons:SQUASH_BEACONS,
  navGraph:SQUASH_NAV, exits:SQUASH_DOORS.filter(d=>d.isExit),
};

export const FLOORS: Record<FloorId, FloorData> = {main:MAIN_FLOOR, squash:SQUASH_FLOOR};

export const floorFromMajor = (major: number): FloorId =>
  major === 1 ? "squash" : "main";