// Globals the type check needs to know about (tsconfig.json; checks only,
// never shipped or loaded). src/core/time-windows.js is a UMD file: in the
// renderer it attaches its value to `self` (the window); in Node it uses
// module.exports and never reads `self`.
declare var self: any;
