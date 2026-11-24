// AgentDesk — the cat customizer in the edit dialog: coat, collar, accessory
// and the preview (docs/ARCHITECTURE_PLAN.md phase 6). Moved from
// src/renderer.js unchanged.

import { tr } from './settings.js';
import { els } from './shared.js';

// ── 猫咪档案卡（编辑对话框换装） ─────────────────────
// 只有三项：毛色（分三组）、项圈颜色、一件配饰。左边的预览按批准的动作逐帧在动。
let catDraft = { look: 'orange', collar: '#c94f2e', accessory: 'none' };
let catBase = null;
let editingProfile = null;
let catSwatchesBuilt = false;

// The draft is also set when the edit dialog rolls a random cat (catalog-dialogs).
function setCatDraft(value) {
  catDraft = value;
}

// 没有自己外观的猫，显示规则和卡片一样：橘猫配默认的红项圈。
function catAppearanceOf(cat, seed) {
  if (!cat || typeof cat !== 'object') return { look: 'orange', accessory: 'none', collar: '#c94f2e' };
  return window.YardCats.resolveCat(cat, seed);
}

function openCatCustomizer(profile) {
  if (!window.YardCats || !window.PixelCats) return;
  editingProfile = profile;
  catBase = profile.cat && typeof profile.cat === 'object' ? profile.cat : null;
  catDraft = catAppearanceOf(profile.cat, profile.id);
  if (!catSwatchesBuilt) { buildCatSwatches(); catSwatchesBuilt = true; }
  syncCatSwatches();
  renderCatPreview();
}

function storedCatDraft() {
  return { coat: null, wear: null, ...window.YardCats.storeCat(catDraft, catBase) };
}

function catLookName(look) {
  return tr('cat.breed.' + look);
}

// 这种毛色能配的项圈：它自带的项圈色排第一，其后是通用的几种。
function catCollarChoices(look) {
  const own = window.CatArt?.LOOKS?.[look]?.collar || null;
  const choices = window.YardCats.COLLAR_CHOICES.slice();
  return own && !choices.includes(own) ? [own, ...choices] : choices;
}

function catTile(label, draw) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cc-tile';
  button.setAttribute('role', 'radio');
  button.setAttribute('aria-label', label);
  button.title = label;
  // 坐着的那一帧在 18 行里放得下每一顶帽子，小样不用多留头顶的空
  const canvas = document.createElement('canvas');
  canvas.width = 40;
  canvas.height = 36;
  button.append(canvas);
  button._draw = () => draw(canvas);
  return button;
}

// 单选组：方向键在组里移动并选中，Tab 只停在选中的那一个。
function bindCatRadioKeys(group) {
  group.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const items = [...group.querySelectorAll('[role="radio"]')];
    const index = items.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const step = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + step + items.length) % items.length;
    items[next].click();
    items[next].focus();
  });
}

function buildCatSwatches() {
  const cats = window.YardCats;
  els.editBreedSwatches.replaceChildren();
  for (const groupId of cats.LOOK_GROUPS) {
    const looks = cats.LOOK_KEYS.filter((look) => cats.lookGroup(look) === groupId);
    if (!looks.length) continue;
    const title = document.createElement('span');
    title.className = 'cc-subtitle';
    title.dataset.catGroup = groupId;
    title.textContent = tr('cat.group.' + groupId);
    const block = document.createElement('div');
    block.className = 'cc-look-group';
    const row = document.createElement('div');
    row.className = 'cc-swatches';
    for (const look of looks) {
      const tile = catTile(catLookName(look), (canvas) => window.PixelCats.drawStill(canvas, {
        look, accessory: window.CatArt.LOOKS[look].accessory || 'none', action: 'onduty', frame: 5, scale: 2, headroom: 0
      }));
      tile.dataset.look = look;
      tile._pressed = () => catDraft.look === look;
      tile.addEventListener('click', () => pickCatLook(look));
      row.append(tile);
    }
    block.append(title, row);
    els.editBreedSwatches.append(block);
  }
  for (const id of cats.ACCESSORY_KEYS) {
    const tile = catTile(tr('cat.acc.' + id), (canvas) => window.PixelCats.drawStill(canvas, {
      look: catDraft.look, accessory: id, collar: catDraft.collar, action: 'onduty', frame: 5, scale: 2, headroom: 0
    }));
    tile.dataset.accessory = id;
    tile._pressed = () => catDraft.accessory === id;
    tile.addEventListener('click', () => { catDraft = { ...catDraft, accessory: id }; syncCatSwatches(); renderCatPreview(); });
    els.editAccSwatches.append(tile);
  }
  [els.editBreedSwatches, els.editCollarSwatches, els.editAccSwatches].forEach(bindCatRadioKeys);
}

function pickCatLook(look) {
  const data = window.CatArt.LOOKS[look] || {};
  const previousOwn = window.CatArt.LOOKS[catDraft.look]?.collar || null;
  let collar = catDraft.collar;
  if (data.collar) collar = data.collar;
  else if (collar === previousOwn && !window.YardCats.COLLAR_CHOICES.includes(collar)) {
    collar = window.YardCats.defaultCatFor(editingProfile?.id || '').collar;
  }
  const accessory = catDraft.accessory === 'none' && data.accessory ? data.accessory : catDraft.accessory;
  catDraft = { look, collar, accessory };
  syncCatSwatches();
  renderCatPreview();
}

function renderCatCollars() {
  const choices = catCollarChoices(catDraft.look);
  const own = window.CatArt?.LOOKS?.[catDraft.look]?.collar || null;
  const signature = choices.join('|');
  if (els.editCollarSwatches.dataset.choices !== signature) {
    els.editCollarSwatches.dataset.choices = signature;
    els.editCollarSwatches.replaceChildren(...choices.map((color) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cc-collar';
      button.setAttribute('role', 'radio');
      const known = color === own ? tr('cat.collar.own') : tr('cat.collar.' + color);
      button.setAttribute('aria-label', known);
      button.title = known;
      const dot = document.createElement('i');
      dot.style.background = color;
      button.append(dot);
      button._pressed = () => catDraft.collar === color;
      button.addEventListener('click', () => { catDraft = { ...catDraft, collar: color }; syncCatSwatches(); renderCatPreview(); });
      return button;
    }));
  }
}

function syncCatSwatches() {
  if (!window.YardCats) return;
  renderCatCollars();
  els.editDialog.querySelectorAll('.cc-tile, .cc-collar').forEach((button) => {
    const pressed = Boolean(button._pressed && button._pressed());
    button.setAttribute('aria-checked', String(pressed));
    button.tabIndex = pressed ? 0 : -1;
  });
  // 配饰的小样戴在当前这只猫身上；毛色的小样画一次就够
  els.editAccSwatches.querySelectorAll('.cc-tile').forEach((button) => button._draw && button._draw());
  els.editBreedSwatches.querySelectorAll('.cc-tile').forEach((button) => {
    if (!button._drawn) { button._draw(); button._drawn = true; }
  });
  if (els.editCatLookName) els.editCatLookName.textContent = catLookName(catDraft.look);
  if (els.editCatLookNote) {
    const key = 'cat.note.' + catDraft.look;
    const note = tr(key);
    els.editCatLookNote.textContent = note === key ? '' : note;
  }
}

function renderCatPreview() {
  if (!window.PixelCats) return;
  window.PixelCats.show(els.editCatCanvas, { ...catDraft, action: 'onduty', scale: 6, seed: 'editor' });
}

export { catAppearanceOf, openCatCustomizer, storedCatDraft, catLookName, catCollarChoices, catTile, bindCatRadioKeys, buildCatSwatches, pickCatLook, renderCatCollars, syncCatSwatches, renderCatPreview, catSwatchesBuilt, setCatDraft };
