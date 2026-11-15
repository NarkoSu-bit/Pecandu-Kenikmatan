// The DOM HUD: health, armour, ammo, money, timer, score, team counts, the
// killfeed, a live minimap, the buy menu, banners and the overlays. It never
// touches the simulation; main.js pushes numbers in and reads callbacks out.
// Every setter caches its last value so the DOM is only touched on change.
import { BUY_ITEMS } from './rounds.js';

const COPY = {
  start: { title: 'SANDLINE', copy: 'Dustline Yard — plant the bomb at Site A or B, or eliminate the Jackals. First to 5 rounds takes the match.', action: 'Deploy' },
  paused: { title: 'SANDLINE', copy: 'Paused. Click to resume.', action: 'Resume' },
  matchEnd: { title: 'Match over', copy: '', action: 'Play again' },
};

export function createHud(world, callbacks) {
  const $ = (id) => document.getElementById(id);
  const els = {
    overlay: $('overlay'), title: $('overlay-title'), copy: $('overlay-copy'), play: $('play'),
    healthNum: $('health-num'), healthBar: $('health-fill'), armorBar: $('armor-fill'),
    ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), weaponName: $('weapon-name'),
    money: $('money-value'), timer: $('timer-value'), score: $('score-value'),
    aliveV: $('alive-v'), aliveJ: $('alive-j'), killfeed: $('killfeed'),
    crosshair: $('crosshair'), hitmarker: $('hitmarker'), vignette: $('vignette'),
    damageDir: $('damage-dir'), banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    bombStatus: $('bomb-status'), bombText: $('bomb-text'), plantBar: $('plant-fill'), plantWrap: $('plant-progress'),
    buyMenu: $('buy-menu'), buyGrid: $('buy-grid'), buyMoney: $('buy-money'),
    minimap: $('minimap'), reloadHint: $('reload-hint'), roundLabel: $('round-label'),
  };
  const mapCtx = els.minimap.getContext('2d');
  const mapRects = world.colliders
    .filter((b) => b.max.y > 0.4 && (b.max.x - b.min.x) * (b.max.z - b.min.z) > 0.4)
    .map((b) => [b.min.x, b.min.z, b.max.x - b.min.x, b.max.z - b.min.z]);

  let last = {};
  let hitTimer = 0;
  let bannerTimer = 0;

  function setText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  function drawMinimap(player, mates, foes, bomb) {
    const W = els.minimap.width;
    const H = els.minimap.height;
    const sx = W / 46;
    const sz = H / 32;
    const px = (x) => (x + 23) * sx;
    const pz = (z) => (z + 16) * sz;
    mapCtx.clearRect(0, 0, W, H);
    mapCtx.fillStyle = 'rgba(28,23,18,0.85)';
    mapCtx.fillRect(0, 0, W, H);
    mapCtx.fillStyle = '#3a332b';
    for (const [x, z, w, d] of mapRects) mapCtx.fillRect(px(x), pz(z), w * sx, d * sz);
    mapCtx.font = 'bold 13px system-ui, sans-serif';
    mapCtx.textAlign = 'center';
    mapCtx.textBaseline = 'middle';
    mapCtx.fillStyle = '#e07830';
    mapCtx.fillRect(px(-19.1), pz(-12.5), 7.2 * sx, 6 * sz);
    mapCtx.fillRect(px(11.9), pz(6), 7.2 * sx, 6 * sz);
    mapCtx.fillStyle = '#1c1712';
    mapCtx.fillText('A', px(-15.5), pz(-9.5));
    mapCtx.fillText('B', px(15.5), pz(9));
    if (bomb && bomb.state === 'planted') {
      mapCtx.fillStyle = Math.sin(performance.now() / 150) > 0 ? '#d43d2a' : '#f0b830';
      mapCtx.beginPath();
      mapCtx.arc(px(bomb.pos.x), pz(bomb.pos.z), 5, 0, Math.PI * 2);
      mapCtx.fill();
    } else if (bomb && bomb.state === 'dropped') {
      mapCtx.fillStyle = '#f0b830';
      mapCtx.beginPath();
      mapCtx.arc(px(bomb.pos.x), pz(bomb.pos.z), 4, 0, Math.PI * 2);
      mapCtx.fill();
    }
    for (const f of foes) {
      mapCtx.fillStyle = '#d43d2a';
      mapCtx.beginPath();
      mapCtx.arc(px(f.pos.x), pz(f.pos.z), 3.5, 0, Math.PI * 2);
      mapCtx.fill();
    }
    for (const m of mates) {
      mapCtx.fillStyle = '#2fa8a0';
      mapCtx.beginPath();
      mapCtx.arc(px(m.pos.x), pz(m.pos.z), 3.5, 0, Math.PI * 2);
      mapCtx.fill();
    }
    if (player) {
      mapCtx.save();
      // The player state keeps its position under .position (bots use .pos).
      mapCtx.translate(px(player.position.x), pz(player.position.z));
      mapCtx.rotate(Math.atan2(-Math.sin(player.yaw), -Math.cos(player.yaw)) + Math.PI / 2);
      mapCtx.fillStyle = '#f2ead8';
      mapCtx.beginPath();
      mapCtx.moveTo(0, -7);
      mapCtx.lineTo(5, 5);
      mapCtx.lineTo(-5, 5);
      mapCtx.closePath();
      mapCtx.fill();
      mapCtx.restore();
    }
  }

  function buildBuy(money, owned, grenades, hasArmor) {
    els.buyGrid.innerHTML = '';
    BUY_ITEMS.forEach((item, i) => {
      const bought = item.kind === 'weapon' ? !!owned[item.id] : item.kind === 'armor' ? hasArmor : grenades[item.id] > 0;
      const afford = money >= item.price;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'buy-item' + (bought ? ' owned' : '') + (afford && !bought ? '' : ' poor');
      btn.innerHTML = `<b>${i + 1} · ${item.name}</b><span>${item.desc}</span><em>$${item.price}${bought ? ' · owned' : ''}</em>`;
      btn.addEventListener('click', () => callbacks.onBuy(item.id));
      els.buyGrid.appendChild(btn);
    });
    els.buyMoney.textContent = `$${money}`;
  }

  return {
    setHealth(hp, armor) {
      setText(els.healthNum, 'hp', String(Math.max(0, Math.ceil(hp))));
      if (last.hpBar !== hp) {
        last.hpBar = hp;
        els.healthBar.style.width = `${Math.max(0, hp)}%`;
        els.healthBar.style.background = hp > 50 ? '#37d67a' : hp > 25 ? '#f0b830' : '#d43d2a';
      }
      if (last.armorBar !== armor) {
        last.armorBar = armor;
        els.armorBar.style.width = `${Math.min(100, armor)}%`;
      }
    },
    setAmmo(mag, reserve, name) {
      setText(els.ammoMag, 'mag', String(mag));
      setText(els.ammoReserve, 'res', `/ ${reserve}`);
      setText(els.weaponName, 'wname', name);
      els.ammoMag.parentElement.classList.toggle('empty', mag === 0);
    },
    setMoney(m) {
      setText(els.money, 'money', `$${m}`);
    },
    setTimer(seconds, phase) {
      const s = Math.max(0, Math.ceil(seconds));
      setText(els.timer, 'timer', `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
      els.timer.classList.toggle('urgent', s <= 10 && phase === 'live');
      setText(els.roundLabel, 'phase', phase === 'buy' ? 'BUY PHASE' : phase === 'live' ? 'ROUND' : '');
    },
    setScore(v, j, round) {
      setText(els.score, 'score', `${v} — ${j}`);
      setText(els.roundLabel, 'round', `ROUND ${round}`);
    },
    setAlive(v, j) {
      setText(els.aliveV, 'aliveV', String(v));
      setText(els.aliveJ, 'aliveJ', String(j));
    },
    setBomb(text, show) {
      els.bombStatus.hidden = !show;
      if (show) setText(els.bombText, 'bomb', text);
    },
    setPlantProgress(p) {
      els.plantWrap.hidden = p <= 0;
      if (p > 0) els.plantBar.style.width = `${Math.round(p * 100)}%`;
    },
    setCrosshairSpread(px) {
      els.crosshair.style.setProperty('--gap', `${px}px`);
    },
    setReloading(on) {
      els.reloadHint.hidden = !on;
    },
    hitMarker(killed, holdMs = 90) {
      els.hitmarker.classList.add('on');
      els.hitmarker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.3)' : '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        els.hitmarker.classList.remove('on');
        els.hitmarker.style.transform = '';
      }, holdMs);
    },
    damageFlash(angleRad) {
      els.vignette.classList.remove('flash');
      void els.vignette.offsetWidth;
      els.vignette.classList.add('flash');
      if (Number.isFinite(angleRad)) {
        els.damageDir.style.transform = `translate(-50%, -50%) rotate(${angleRad}rad)`;
        els.damageDir.classList.add('on');
        setTimeout(() => els.damageDir.classList.remove('on'), 700);
      }
    },
    killfeed(killer, victim, headshot, killerTeam) {
      const row = document.createElement('div');
      row.className = 'kill-row';
      row.innerHTML = `<span class="${killerTeam === 'vanguard' ? 'team-v' : 'team-j'}">${killer}</span> ${headshot ? '<b class="hs">◎</b> ' : ''}<span class="team-j">${victim}</span>`;
      els.killfeed.prepend(row);
      while (els.killfeed.children.length > 5) els.killfeed.lastChild.remove();
      setTimeout(() => row.remove(), 6000);
    },
    banner(title, sub, ms = 2600) {
      els.bannerTitle.textContent = title;
      els.bannerSub.textContent = sub;
      els.banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => {
        els.banner.hidden = true;
      }, ms);
    },
    hideBanner() {
      clearTimeout(bannerTimer);
      els.banner.hidden = true;
    },
    showBuy(money, owned, grenades, hasArmor) {
      buildBuy(money, owned, grenades, hasArmor);
      els.buyMenu.hidden = false;
    },
    hideBuy() {
      els.buyMenu.hidden = true;
    },
    refreshBuy(money, owned, grenades, hasArmor) {
      if (!els.buyMenu.hidden) buildBuy(money, owned, grenades, hasArmor);
    },
    showOverlay(mode, data = {}) {
      const text = COPY[mode];
      els.title.textContent = text.title;
      els.copy.textContent = mode === 'matchEnd' ? `${data.winner === 'vanguard' ? 'Vanguard take the match' : 'The Jackals take the match'} — ${data.score.vanguard} : ${data.score.jackal}.` : text.copy;
      els.play.textContent = text.action;
      els.overlay.hidden = false;
      els.play.focus();
    },
    hideOverlay() {
      els.overlay.hidden = true;
    },
    onPlay(handler) {
      els.play.addEventListener('click', handler);
    },
    drawMinimap,
  };
}
