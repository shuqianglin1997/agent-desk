'use strict';

/*
 * Stills for print: pictures of the film taken out of its running order, for
 * an article that walks through what Catshelf does. Each is what the film shows
 * at a moment (film.js, still): t is the moment; tilt, when given, is where a
 * close-up stands instead of the film's own camera, so that the thing shown is
 * whole; the caption and the cursor can be left out.
 */

const SETS = {
  // 公众号正文, in the order the article tells it.
  wechat: [
    // Six accounts on the shelf, each doing something else, with their nameplates.
    { name: '01-shelf', t: 17.75, cursor: false },
    // One account's chats: two answered ("新回复"), one of them tagged.
    { name: '02-ledger', t: 21, cursor: false },
    // A row ticked and "复制会话信息" pressed: the seal at the end of the row, the footer says it is copied.
    // 4px above where the film stands, so the toolbar is whole.
    { name: '03-copy', t: 27.25, tilt: 296 },
    // The desktop: pasted into another client's window, which reads the earlier chat and carries on.
    { name: '04-paste', t: 31.5, cursor: false },
    // The recruit dialog on "新来一只", all of it; the film looks at its top part only, and its caption would lie on it.
    { name: '05-recruit', t: 42.5, tilt: 150, caption: false, cursor: false }
  ]
};

module.exports = { SETS };
