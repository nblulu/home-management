  const STORED_HASH = '071c00fa66449df33ffca0f3b71da9f9375eaf8feef471f348c9bac19e6f4914';
  const AUTH_KEY = 'hm_authed';

  async function sha256(str) {
    const bytes = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map(x => x.toString(16).padStart(2, '0'))
      .join('');
  }

  async function checkPassword() {
    const overlay = document.getElementById('auth-overlay');
    const card = document.getElementById('auth-card');
    const input = document.getElementById('auth-input');
    const error = document.getElementById('auth-error');
    if (!overlay || !card || !input || !error) return;

    error.textContent = '';
    const hash = await sha256(input.value);

    if (hash === STORED_HASH) {
      sessionStorage.setItem(AUTH_KEY, '1');
      overlay.classList.add('fade-out');
      overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
      return;
    }

    input.value = '';
    input.focus();
    error.textContent = 'Incorrect password';
    card.classList.remove('shake');
    void card.offsetWidth;
    card.classList.add('shake');
  }

  window.checkPassword = checkPassword;

  const authOverlay = document.getElementById('auth-overlay');
  if (sessionStorage.getItem(AUTH_KEY) === '1') {
    authOverlay?.remove();
  } else {
    document.getElementById('auth-input')?.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') checkPassword();
    });
  }

  function showSection(id) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    event.target.classList.add('active');
  }

  function showDay(id, btn) {
    document.querySelectorAll('.timeline').forEach(t => t.style.display = 'none');
    document.querySelectorAll('.day-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(id).style.display = 'block';
    btn.classList.add('active');
  }

  // Grocery checkboxes
  document.querySelectorAll('.grocery-item input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', function() {
      this.closest('.grocery-item').classList.toggle('checked', this.checked);
    });
  });

  // ── Calendar App ──────────────────────────────────────────────────────────
  (function () {
    'use strict';

    const CAT_COLORS = {
      family: '#7A9E7E', school: '#C4704A',
      health: '#C4849A', work: '#7A9BB5', personal: '#D4A853'
    };
    const PERSON_COLORS = { mom: '#C4849A', dad: '#7A9BB5', son: '#C4704A', daughter: '#D4A853', family: '#7A9E7E' };
    const MONTHS = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
    const DAYS_S = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const DAYS_L = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

    // ── EventStore ──────────────────────────────────────────────────────────
    const Store = {
      KEY: 'hsh_cal_events',
      all() { try { return JSON.parse(localStorage.getItem(this.KEY) || '[]'); } catch { return []; } },
      _save(arr) { localStorage.setItem(this.KEY, JSON.stringify(arr)); },
      create(e) {
        e.id = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : Date.now().toString(36) + Math.random().toString(36).slice(2);
        const arr = this.all(); arr.push(e); this._save(arr); return e;
      },
      update(id, patch) { this._save(this.all().map(e => e.id === id ? { ...e, ...patch } : e)); },
      remove(id)        { this._save(this.all().filter(e => e.id !== id)); },
    };

    // ── SubscriptionStore ─────────────────────────────────────────────────────
    const SubStore = {
      KEY: 'hsh_cal_subs',
      all()  { try { return JSON.parse(localStorage.getItem(this.KEY) || '[]'); } catch { return []; } },
      _save(arr) { localStorage.setItem(this.KEY, JSON.stringify(arr)); },
      add(sub) {
        sub.id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
        sub.lastSync = null; sub.error = null;
        const arr = this.all(); arr.push(sub); this._save(arr); return sub;
      },
      remove(id) {
        this._save(this.all().filter(s => s.id !== id));
        Store._save(Store.all().filter(e => !e._source || e._source.calendarId !== id));
      },
      updateSync(id, ts, err) {
        this._save(this.all().map(s => s.id === id ? { ...s, lastSync: ts, error: err || null } : s));
      },
    };

    // ── ICS Parser ────────────────────────────────────────────────────────────
    function parseICSDateTime(v) {
      const d = v.replace('Z', '');
      return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${d.slice(9,11)}:${d.slice(11,13)}`;
    }

    function parseRRULE(r) {
      if (!r) return { type: 'none', days: [], until: null };
      const p = {};
      r.split(';').forEach(s => { const [k, v] = s.split('='); if (k && v !== undefined) p[k] = v; });
      const MAP = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
      const freq = (p.FREQ || '').toUpperCase();
      const type = freq === 'DAILY' ? 'daily' : freq === 'WEEKLY' ? 'weekly' : freq === 'MONTHLY' ? 'monthly' : 'none';
      const days = p.BYDAY ? p.BYDAY.split(',').map(d => MAP[d.replace(/[+-\d]/g, '')]).filter(d => d !== undefined) : [];
      let until = null;
      if (p.UNTIL) { const u = p.UNTIL.replace(/[TZ]/g, '').slice(0, 8); until = `${u.slice(0,4)}-${u.slice(4,6)}-${u.slice(6,8)}`; }
      return { type, days, until };
    }

    function parseICS(text) {
      const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
      const events = [];
      let cur = null;

      for (const raw of lines) {
        if (raw === 'BEGIN:VEVENT') { cur = {}; continue; }
        if (raw === 'END:VEVENT')   { if (cur && cur.uid) events.push(cur); cur = null; continue; }
        if (!cur) continue;

        const ci = raw.indexOf(':');
        if (ci === -1) continue;
        const propFull = raw.slice(0, ci), val = raw.slice(ci + 1);
        const si = propFull.indexOf(';');
        const prop   = (si !== -1 ? propFull.slice(0, si) : propFull).toUpperCase();
        const params = si !== -1 ? propFull.slice(si + 1) : '';

        if      (prop === 'UID')         { cur.uid  = val; }
        else if (prop === 'SUMMARY')     { cur.title = val.replace(/\\n/g, '\n').replace(/\\([,;\\])/g, '$1'); }
        else if (prop === 'DESCRIPTION') { cur.desc  = val.replace(/\\n/g, '\n').replace(/\\([,;\\])/g, '$1'); }
        else if (prop === 'DTSTART') {
          const isDate = params.includes('VALUE=DATE') || val.length === 8;
          cur.allDay = isDate;
          cur.start  = isDate ? `${val.slice(0,4)}-${val.slice(4,6)}-${val.slice(6,8)}` : parseICSDateTime(val);
        }
        else if (prop === 'DTEND') {
          const isDate = params.includes('VALUE=DATE') || val.length === 8;
          if (isDate) {
            const d = new Date(`${val.slice(0,4)}-${val.slice(4,6)}-${val.slice(6,8)}T00:00`);
            d.setDate(d.getDate() - 1);
            cur.end = d.toISOString().slice(0, 10);
          } else {
            cur.end = parseICSDateTime(val);
          }
        }
        else if (prop === 'RRULE') { cur.rrule = val; }
      }

      return events.map(e => {
        const start = e.start || '';
        let end = e.end || e.start || '';
        if (end && start && end < start) end = start;
        return {
          title: e.title || '(No title)',
          description: e.desc || '',
          start, end,
          allDay: !!e.allDay,
          category: 'family',
          color: '#7A9E7E',
          recurring: parseRRULE(e.rrule || ''),
          uid: e.uid,
        };
      });
    }

    // ── Seed data ────────────────────────────────────────────────────────────
    function seed() {
      if (localStorage.getItem('hsh_cal_seeded_v2')) return;
      const now = new Date(), y = now.getFullYear(), m = now.getMonth();
      const dt = (d, h, mn = 0) => new Date(y, m, d, h, mn).toISOString().slice(0, 16);
      const ds = d => new Date(y, m, d).toISOString().slice(0, 10);
      [
        { title: 'Karam — Soccer Practice', description: 'School team practice', allDay: false,
          start: dt(6, 16), end: dt(6, 17, 30), category: 'school', color: CAT_COLORS.school,
          recurring: { type: 'weekly', days: [2, 4], until: null } },
        { title: 'Mom — Workout', description: 'Morning gym session', allDay: false,
          start: dt(5, 6), end: dt(5, 7), category: 'health', color: CAT_COLORS.health,
          recurring: { type: 'weekly', days: [1, 3, 5], until: null } },
        { title: 'Dad — Workout', description: 'Morning gym session', allDay: false,
          start: dt(5, 7), end: dt(5, 8), category: 'health', color: CAT_COLORS.work,
          recurring: { type: 'weekly', days: [1, 3, 6], until: null } },
        { title: 'Family Dinner 🍽️', description: 'Sunday family meal', allDay: false,
          start: dt(7, 18), end: dt(7, 20), category: 'family', color: CAT_COLORS.family,
          recurring: { type: 'weekly', days: [0], until: null } },
        { title: 'Naya — Preschool', description: '', allDay: true,
          start: ds(5), end: ds(5), category: 'school', color: CAT_COLORS.personal,
          recurring: { type: 'weekly', days: [1, 2, 3, 4, 5], until: null } },
        { title: "Karam's Birthday Party 🎉", description: 'Invite friends, cake at 3 pm', allDay: true,
          start: ds(18), end: ds(18), category: 'family', color: CAT_COLORS.family,
          recurring: { type: 'none', days: [], until: null } },
        { title: "Doctor Appointment", description: "Annual checkup — Naya", allDay: false,
          start: dt(22, 10), end: dt(22, 11), category: 'health', color: CAT_COLORS.health,
          recurring: { type: 'none', days: [], until: null } },
      ].forEach(e => Store.create(e));
      localStorage.setItem('hsh_cal_seeded_v2', '1');
    }

    // ── State ─────────────────────────────────────────────────────────────────
    const S = {
      current: new Date(),
      view: 'month',
      search: '',
      cat: 'all',
      editingId: null,
      get y() { return this.current.getFullYear(); },
      get m() { return this.current.getMonth(); },
    };

    // ── Helpers ───────────────────────────────────────────────────────────────
    function toDate(iso) {
      return new Date(iso && iso.length === 10 ? iso + 'T00:00' : iso);
    }
    function sameDay(a, b) {
      return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    }
    function dkey(d) {
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }
    function evtColor(e) { return e.color || CAT_COLORS[e.category] || '#7A9E7E'; }
    function contrast(hex) {
      const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
      return (r*0.299 + g*0.587 + b*0.114) > 145 ? '#2C2C2C' : '#ffffff';
    }
    function fmtTime(iso) {
      if (!iso || iso.length === 10) return 'All day';
      const d = toDate(iso), h = d.getHours(), mn = d.getMinutes();
      const ap = h >= 12 ? 'pm' : 'am', hh = h % 12 || 12;
      return `${hh}:${String(mn).padStart(2,'0')} ${ap}`;
    }
    function fmtDate(d) { return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; }

    // ── Expand recurring events over a date range ─────────────────────────────
    function expand(rangeStart, rangeEnd) {
      const rs = new Date(rangeStart); rs.setHours(0,0,0,0);
      const re = new Date(rangeEnd);   re.setHours(23,59,59,999);
      const out = [];

      Store.all().forEach(evt => {
        const rec = evt.recurring || {};
        if (!rec.type || rec.type === 'none') {
          const es = toDate(evt.start), ee = toDate(evt.end || evt.start);
          if (es <= re && ee >= rs) out.push(evt);
          return;
        }
        const until   = rec.until ? new Date(rec.until) : re;
        const evtS    = toDate(evt.start);
        const evtE    = toDate(evt.end || evt.start);
        const dur     = evtE - evtS;

        if (rec.type === 'weekly') {
          const days = rec.days && rec.days.length ? rec.days : [evtS.getDay()];
          const cur = new Date(rs);
          while (cur <= re && cur <= until) {
            if (days.includes(cur.getDay())) {
              const s = new Date(cur);
              s.setHours(evtS.getHours(), evtS.getMinutes(), 0, 0);
              const e = new Date(s.getTime() + dur);
              out.push({ ...evt,
                start: evt.allDay ? s.toISOString().slice(0,10) : s.toISOString().slice(0,16),
                end:   evt.allDay ? e.toISOString().slice(0,10) : e.toISOString().slice(0,16),
                _base: evt.id });
            }
            cur.setDate(cur.getDate() + 1);
          }
        } else if (rec.type === 'daily') {
          const cur = new Date(rs);
          while (cur <= re && cur <= until) {
            const s = new Date(cur);
            s.setHours(evtS.getHours(), evtS.getMinutes(), 0, 0);
            const e = new Date(s.getTime() + dur);
            out.push({ ...evt,
              start: evt.allDay ? s.toISOString().slice(0,10) : s.toISOString().slice(0,16),
              end:   evt.allDay ? e.toISOString().slice(0,10) : e.toISOString().slice(0,16),
              _base: evt.id });
            cur.setDate(cur.getDate() + 1);
          }
        } else if (rec.type === 'monthly') {
          const td = evtS.getDate();
          const cur = new Date(rs.getFullYear(), rs.getMonth(), td);
          while (cur <= re && cur <= until) {
            if (cur >= rs) {
              const s = new Date(cur);
              s.setHours(evtS.getHours(), evtS.getMinutes(), 0, 0);
              const e = new Date(s.getTime() + dur);
              out.push({ ...evt,
                start: evt.allDay ? s.toISOString().slice(0,10) : s.toISOString().slice(0,16),
                end:   evt.allDay ? e.toISOString().slice(0,10) : e.toISOString().slice(0,16),
                _base: evt.id });
            }
            cur.setMonth(cur.getMonth() + 1);
          }
        }
      });
      return out;
    }

    function filtered(evts) {
      return evts.filter(e => {
        if (S.cat !== 'all' && e.category !== S.cat) return false;
        if (S.search) {
          const q = S.search.toLowerCase();
          if (!e.title.toLowerCase().includes(q) && !(e.description || '').toLowerCase().includes(q)) return false;
        }
        return true;
      });
    }

    // ── Render dispatcher ─────────────────────────────────────────────────────
    function render() {
      updateTitle();
      if (S.view === 'month')  renderMonth();
      if (S.view === 'week')   renderWeek();
      if (S.view === 'day')    renderDay();
      if (S.view === 'agenda') renderAgenda();
      renderMiniCal();
      renderUpcoming();
    }

    function updateTitle() {
      const el = document.getElementById('cal-title');
      if (!el) return;
      if (S.view === 'month' || S.view === 'agenda') {
        el.textContent = `${MONTHS[S.m]} ${S.y}`;
      } else if (S.view === 'week') {
        const ws = weekStart(S.current), we = new Date(ws);
        we.setDate(we.getDate() + 6);
        el.textContent = `${MONTHS[ws.getMonth()]} ${ws.getDate()} – ${we.getDate()}, ${ws.getFullYear()}`;
      } else {
        el.textContent = fmtDate(S.current);
      }
    }

    // ── Month View ─────────────────────────────────────────────────────────────
    function renderMonth() {
      const wrap = document.getElementById('cal-month-view');
      if (!wrap) return;
      const today = new Date();
      const firstDay = new Date(S.y, S.m, 1).getDay();
      const days     = new Date(S.y, S.m + 1, 0).getDate();
      const evts     = filtered(expand(new Date(S.y, S.m, 1), new Date(S.y, S.m + 1, 0)));

      const byDay = {};
      evts.forEach(e => {
        const k = dkey(toDate(e.start));
        (byDay[k] = byDay[k] || []).push(e);
      });

      const grid = document.createElement('div');
      grid.className = 'month-grid';
      DAYS_S.forEach(d => {
        const h = document.createElement('div'); h.className = 'month-dow'; h.textContent = d; grid.appendChild(h);
      });
      for (let i = 0; i < firstDay; i++) {
        const b = document.createElement('div'); b.className = 'month-cell empty'; grid.appendChild(b);
      }
      for (let d = 1; d <= days; d++) {
        const cell = document.createElement('div');
        cell.className = 'month-cell' + (sameDay(new Date(S.y, S.m, d), today) ? ' today' : '');
        const key = dkey(new Date(S.y, S.m, d));

        cell.addEventListener('dragover', ev => { ev.preventDefault(); cell.classList.add('drag-over'); });
        cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
        cell.addEventListener('drop', ev => {
          ev.preventDefault(); cell.classList.remove('drag-over');
          const id = ev.dataTransfer.getData('text/plain');
          if (id) DnD.drop(id, new Date(S.y, S.m, d));
        });
        cell.addEventListener('click', ev => {
          if (ev.target === cell || ev.target.classList.contains('month-day-num'))
            Modal.open(new Date(S.y, S.m, d, 9, 0));
        });

        const num = document.createElement('div');
        num.className = 'month-day-num'; num.textContent = d;
        cell.appendChild(num);

        const dayEvts = byDay[key] || [];
        const MAX = 3;
        dayEvts.slice(0, MAX).forEach(e => cell.appendChild(makeChip(e)));
        if (dayEvts.length > MAX) {
          const more = document.createElement('div');
          more.className = 'more-chip';
          more.textContent = `+${dayEvts.length - MAX} more`;
          more.addEventListener('click', ev => {
            ev.stopPropagation();
            S.current = new Date(S.y, S.m, d);
            setView('day');
          });
          cell.appendChild(more);
        }
        grid.appendChild(cell);
      }
      wrap.innerHTML = '';
      wrap.appendChild(grid);
    }

    function makeChip(e) {
      const chip = document.createElement('div');
      chip.className = 'event-chip';
      const bg = evtColor(e);
      chip.style.background = bg + '28';
      chip.style.color = bg;
      chip.style.borderLeftColor = bg;
      chip.textContent = e.title;
      chip.draggable = true;
      const id = e.id || e._base;
      chip.addEventListener('click', ev => { ev.stopPropagation(); Modal.open(null, id); });
      chip.addEventListener('dragstart', ev => {
        chip.classList.add('dragging');
        ev.dataTransfer.setData('text/plain', id);
      });
      chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
      return chip;
    }

    // ── Week View ───────────────────────────────────────────────────────────────
    function weekStart(d) {
      const s = new Date(d); s.setDate(s.getDate() - s.getDay()); s.setHours(0,0,0,0); return s;
    }

    function renderWeek() {
      const wrap = document.getElementById('cal-week-view');
      if (!wrap) return;
      const ws = weekStart(S.current);
      const we = new Date(ws); we.setDate(we.getDate() + 6);
      const today = new Date();
      const evts = filtered(expand(ws, we));

      const cont = document.createElement('div');

      // Header
      const hdr = document.createElement('div'); hdr.className = 'week-header';
      const sp = document.createElement('div'); sp.className = 'week-header-spacer'; hdr.appendChild(sp);
      for (let i = 0; i < 7; i++) {
        const day = new Date(ws); day.setDate(day.getDate() + i);
        const dh = document.createElement('div');
        dh.className = 'week-day-hdr' + (sameDay(day, today) ? ' today' : '');
        const dn = document.createElement('div'); dn.className = 'week-day-num'; dn.textContent = day.getDate();
        const dl = document.createElement('div'); dl.textContent = DAYS_S[day.getDay()];
        dh.appendChild(dn); dh.appendChild(dl); hdr.appendChild(dh);
      }
      cont.appendChild(hdr);

      // Body
      const body = document.createElement('div'); body.className = 'week-body';
      const tc = document.createElement('div'); tc.className = 'week-time-col';
      for (let h = 0; h < 24; h++) {
        const s = document.createElement('div'); s.className = 'week-time-slot';
        s.textContent = h === 0 ? '' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h-12}pm`;
        tc.appendChild(s);
      }
      body.appendChild(tc);

      for (let i = 0; i < 7; i++) {
        const day = new Date(ws); day.setDate(day.getDate() + i);
        const col = document.createElement('div');
        col.className = 'week-day-col' + (sameDay(day, today) ? ' today-col' : '');
        for (let h = 0; h < 24; h++) {
          const line = document.createElement('div'); line.className = 'week-hour-line';
          const hh = h;
          line.addEventListener('click', () => { const d = new Date(day); d.setHours(hh,0,0,0); Modal.open(d); });
          col.appendChild(line);
        }
        col.addEventListener('dragover', ev => { ev.preventDefault(); col.classList.add('drag-over'); });
        col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
        col.addEventListener('drop', ev => {
          ev.preventDefault(); col.classList.remove('drag-over');
          const id = ev.dataTransfer.getData('text/plain');
          if (id) DnD.drop(id, day);
        });

        evts.filter(e => sameDay(toDate(e.start), day)).forEach(e => {
          const es = toDate(e.start), ee = toDate(e.end || e.start);
          const top    = (es.getHours() * 60 + es.getMinutes()) / 60 * 46;
          const height = Math.max((ee - es) / 3600000 * 46, 18);
          const el = document.createElement('div'); el.className = 'week-event';
          const bg = evtColor(e);
          el.style.cssText = `background:${bg};color:${contrast(bg)};top:${top}px;height:${height}px`;
          el.textContent = e.title; el.draggable = true;
          const id = e.id || e._base;
          el.addEventListener('click', ev => { ev.stopPropagation(); Modal.open(null, id); });
          el.addEventListener('dragstart', ev => { el.classList.add('dragging'); ev.dataTransfer.setData('text/plain', id); });
          el.addEventListener('dragend', () => el.classList.remove('dragging'));
          col.appendChild(el);
        });
        body.appendChild(col);
      }
      cont.appendChild(body);
      wrap.innerHTML = ''; wrap.appendChild(cont);
    }

    // ── Day View ───────────────────────────────────────────────────────────────
    function renderDay() {
      const wrap = document.getElementById('cal-day-view');
      if (!wrap) return;
      const evts = filtered(expand(S.current, S.current));

      const cont = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'day-date-title';
      title.textContent = `${DAYS_L[S.current.getDay()]}, ${fmtDate(S.current)}`;
      cont.appendChild(title);

      const body = document.createElement('div'); body.className = 'day-body';
      const tc = document.createElement('div'); tc.className = 'day-time-col';
      const ec = document.createElement('div'); ec.className = 'day-events-col';

      for (let h = 0; h < 24; h++) {
        const ts = document.createElement('div'); ts.className = 'day-hour-slot';
        ts.textContent = h === 0 ? '' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h-12}pm`;
        tc.appendChild(ts);
        const line = document.createElement('div'); line.className = 'day-hour-line';
        const hh = h;
        line.addEventListener('click', () => { const d = new Date(S.current); d.setHours(hh,0,0,0); Modal.open(d); });
        ec.appendChild(line);
      }

      evts.forEach(e => {
        const es = toDate(e.start), ee = toDate(e.end || e.start);
        const top    = (es.getHours() * 60 + es.getMinutes()) / 60 * 46;
        const height = Math.max((ee - es) / 3600000 * 46, 22);
        const el = document.createElement('div'); el.className = 'day-event';
        const bg = evtColor(e);
        el.style.cssText = `background:${bg};color:${contrast(bg)};top:${top}px;height:${height}px`;
        el.innerHTML = `<strong>${e.title}</strong> <span style="opacity:.82;font-weight:400">· ${fmtTime(e.start)}</span>`;
        const id = e.id || e._base;
        el.addEventListener('click', () => Modal.open(null, id));
        ec.appendChild(el);
      });

      body.appendChild(tc); body.appendChild(ec);
      cont.appendChild(body);
      wrap.innerHTML = ''; wrap.appendChild(cont);
    }

    // ── Agenda View ────────────────────────────────────────────────────────────
    function renderAgenda() {
      const wrap = document.getElementById('cal-agenda-view');
      if (!wrap) return;
      const today = new Date();
      const evts = filtered(expand(new Date(S.y, S.m, 1), new Date(S.y, S.m + 1, 0)));

      const byDay = {};
      evts.forEach(e => {
        const k = dkey(toDate(e.start));
        if (!byDay[k]) byDay[k] = { date: toDate(e.start), items: [] };
        byDay[k].items.push(e);
      });

      const cont = document.createElement('div'); cont.className = 'agenda-view';
      const keys = Object.keys(byDay).sort();

      if (!keys.length) {
        const em = document.createElement('div'); em.className = 'agenda-empty';
        em.textContent = 'No events this month.'; cont.appendChild(em);
      } else {
        keys.forEach(k => {
          const { date, items } = byDay[k];
          const grp = document.createElement('div'); grp.className = 'agenda-day-group';
          const lbl = document.createElement('div');
          lbl.className = 'agenda-day-label' + (sameDay(date, today) ? ' today-label' : '');
          lbl.textContent = `${DAYS_L[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}`;
          grp.appendChild(lbl);
          items.forEach(e => {
            const row = document.createElement('div'); row.className = 'agenda-event-row';
            const bar = document.createElement('div'); bar.className = 'agenda-color-bar';
            bar.style.background = evtColor(e);
            const info = document.createElement('div'); info.className = 'agenda-event-info';
            info.innerHTML = `<div class="agenda-event-title">${e.title}</div>
              <div class="agenda-event-meta">${e.allDay ? 'All day' : fmtTime(e.start) + (e.end ? ' – ' + fmtTime(e.end) : '')}${e.description ? ' · ' + e.description : ''}</div>`;
            row.appendChild(bar); row.appendChild(info);
            const id = e.id || e._base;
            row.addEventListener('click', () => Modal.open(null, id));
            grp.appendChild(row);
          });
          cont.appendChild(grp);
        });
      }
      wrap.innerHTML = ''; wrap.appendChild(cont);
    }

    // ── Mini Calendar ──────────────────────────────────────────────────────────
    function renderMiniCal() {
      const grid = document.getElementById('mini-cal-grid');
      const ttl  = document.getElementById('mini-cal-title');
      if (!grid || !ttl) return;
      ttl.textContent = `${MONTHS[S.m]} ${S.y}`;
      const firstDay = new Date(S.y, S.m, 1).getDay();
      const days     = new Date(S.y, S.m + 1, 0).getDate();
      const today    = new Date();
      const evts     = expand(new Date(S.y, S.m, 1), new Date(S.y, S.m + 1, 0));
      const hasDays  = new Set(evts.map(e => toDate(e.start).getDate()));

      grid.innerHTML = '';
      DAYS_S.forEach(d => {
        const h = document.createElement('div'); h.className = 'mini-cal-dow'; h.textContent = d[0]; grid.appendChild(h);
      });
      for (let i = 0; i < firstDay; i++) {
        const b = document.createElement('div'); b.className = 'mini-cal-day empty'; grid.appendChild(b);
      }
      for (let d = 1; d <= days; d++) {
        const el = document.createElement('div'); el.className = 'mini-cal-day';
        if (sameDay(new Date(S.y, S.m, d), today)) el.classList.add('today');
        if (hasDays.has(d)) el.classList.add('has-event');
        el.textContent = d;
        const dd = d;
        el.addEventListener('click', () => { S.current = new Date(S.y, S.m, dd); render(); });
        grid.appendChild(el);
      }
    }

    // ── Upcoming ───────────────────────────────────────────────────────────────
    function renderUpcoming() {
      const cont = document.getElementById('upcoming-list');
      if (!cont) return;
      const from = new Date(); from.setHours(0,0,0,0);
      const to   = new Date(from); to.setDate(to.getDate() + 14);
      const evts = filtered(expand(from, to))
        .sort((a, b) => toDate(a.start) - toDate(b.start))
        .slice(0, 6);

      if (!evts.length) {
        cont.innerHTML = '<div style="font-size:.77rem;color:var(--cw-muted);text-align:center;padding:.5rem">No upcoming events</div>';
        return;
      }
      cont.innerHTML = '';
      evts.forEach(e => {
        const item = document.createElement('div'); item.className = 'upcoming-item';
        const dot  = document.createElement('div'); dot.className = 'upcoming-dot'; dot.style.background = evtColor(e);
        const info = document.createElement('div'); info.className = 'upcoming-info';
        const d = toDate(e.start);
        info.innerHTML = `<div class="upcoming-title">${e.title}</div>
          <div class="upcoming-when">${MONTHS[d.getMonth()].slice(0,3)} ${d.getDate()} · ${e.allDay ? 'All day' : fmtTime(e.start)}</div>`;
        item.appendChild(dot); item.appendChild(info);
        const id = e.id || e._base;
        item.addEventListener('click', () => Modal.open(null, id));
        cont.appendChild(item);
      });
    }

    // ── Modal Manager ──────────────────────────────────────────────────────────
    const Modal = {
      el:   null,
      form: null,
      init() {
        this.el   = document.getElementById('event-modal');
        this.form = document.getElementById('event-form');
        if (!this.el) return;
        document.getElementById('modal-close-btn').addEventListener('click',  () => this.close());
        document.getElementById('modal-cancel-btn').addEventListener('click', () => this.close());
        document.getElementById('modal-save-btn').addEventListener('click',   () => this.save());
        document.getElementById('delete-event-btn').addEventListener('click', () => Confirm.open());
        this.el.addEventListener('click', ev => { if (ev.target === this.el) this.close(); });
        this.form.querySelector('[name=recurring]').addEventListener('change', function () {
          document.getElementById('recurring-until-group').classList.toggle('show', this.value !== 'none');
        });
        this.form.querySelector('[name=category]').addEventListener('change', function () {
          const c = { family:'#7A9E7E', school:'#C4704A', health:'#C4849A', work:'#7A9BB5', personal:'#D4A853' };
          if (c[this.value]) document.querySelector('#event-form [name=color]').value = c[this.value];
        });
      },
      open(date, id) {
        if (!this.el) return;
        S.editingId = id || null;
        document.getElementById('modal-heading').textContent = id ? 'Edit Event' : 'New Event';
        document.getElementById('delete-event-btn').style.display = id ? '' : 'none';

        if (id) {
          const e = Store.all().find(x => x.id === id);
          if (!e) return;
          this.form.querySelector('[name=title]').value        = e.title || '';
          this.form.querySelector('[name=description]').value  = e.description || '';
          this.form.querySelector('[name=start]').value        = e.start && e.start.length > 10 ? e.start : (e.start || '') + (e.start && e.start.length === 10 ? 'T00:00' : '');
          this.form.querySelector('[name=end]').value          = e.end && e.end.length > 10 ? e.end : (e.end || '') + (e.end && e.end.length === 10 ? 'T00:00' : '');
          this.form.querySelector('[name=allDay]').checked     = !!e.allDay;
          this.form.querySelector('[name=category]').value     = e.category || 'family';
          this.form.querySelector('[name=color]').value        = e.color || '#7A9E7E';
          this.form.querySelector('[name=recurring]').value    = e.recurring && e.recurring.type ? e.recurring.type : 'none';
          this.form.querySelector('[name=recurringUntil]').value = (e.recurring && e.recurring.until) || '';
          document.getElementById('recurring-until-group').classList.toggle('show', e.recurring && e.recurring.type !== 'none');
        } else {
          this.form.reset();
          if (date) {
            this.form.querySelector('[name=start]').value = date.toISOString().slice(0,16);
            const end = new Date(date.getTime() + 3600000);
            this.form.querySelector('[name=end]').value = end.toISOString().slice(0,16);
          }
          this.form.querySelector('[name=color]').value = '#7A9E7E';
          document.getElementById('recurring-until-group').classList.remove('show');
        }
        this.el.classList.add('open');
        setTimeout(() => this.form.querySelector('[name=title]').focus(), 60);
      },
      close() { if (this.el) { this.el.classList.remove('open'); S.editingId = null; } },
      save() {
        const f    = this.form;
        const title = f.querySelector('[name=title]').value.trim();
        if (!title) { f.querySelector('[name=title]').focus(); return; }
        const data = {
          title,
          description: f.querySelector('[name=description]').value.trim(),
          start: f.querySelector('[name=start]').value,
          end:   f.querySelector('[name=end]').value,
          allDay: f.querySelector('[name=allDay]').checked,
          category: f.querySelector('[name=category]').value,
          color: f.querySelector('[name=color]').value,
          recurring: {
            type:  f.querySelector('[name=recurring]').value,
            days:  [],
            until: f.querySelector('[name=recurringUntil]').value || null
          }
        };
        S.editingId ? Store.update(S.editingId, data) : Store.create(data);
        this.close();
        render();
      }
    };

    // ── Confirm Delete ─────────────────────────────────────────────────────────
    const Confirm = {
      el: null,
      init() {
        this.el = document.getElementById('confirm-modal');
        if (!this.el) return;
        document.getElementById('confirm-cancel-btn').addEventListener('click', () => this.close());
        document.getElementById('confirm-delete-btn').addEventListener('click', () => {
          if (S.editingId) { Store.remove(S.editingId); this.close(); Modal.close(); render(); }
        });
        this.el.addEventListener('click', ev => { if (ev.target === this.el) this.close(); });
      },
      open()  { if (this.el) this.el.classList.add('open'); },
      close() { if (this.el) this.el.classList.remove('open'); }
    };

    // ── Drag & Drop ────────────────────────────────────────────────────────────
    const DnD = {
      drop(id, newDate) {
        const evt = Store.all().find(e => e.id === id);
        if (!evt) return;
        const oldS = toDate(evt.start), oldE = toDate(evt.end || evt.start);
        const dur  = oldE - oldS;
        const ns   = new Date(newDate); ns.setHours(oldS.getHours(), oldS.getMinutes(), 0, 0);
        const ne   = new Date(ns.getTime() + dur);
        Store.update(id, {
          start: evt.allDay ? ns.toISOString().slice(0,10) : ns.toISOString().slice(0,16),
          end:   evt.allDay ? ne.toISOString().slice(0,10) : ne.toISOString().slice(0,16)
        });
        render();
      }
    };

    // ── iCal Sync ─────────────────────────────────────────────────────────────
    async function syncSubscription(sub) {
      const url = sub.url.replace(/^webcal:/i, 'https:');
      let text;
      try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        text = await resp.text();
      } catch (err) {
        SubStore.updateSync(sub.id, new Date().toISOString(), err.message || 'fetch-error');
        SubModal.render();
        return;
      }
      const color  = PERSON_COLORS[sub.person] || '#7A9E7E';
      const others = Store.all().filter(e => !e._source || e._source.calendarId !== sub.id);
      const fresh  = parseICS(text).map(e => ({
        ...e, color,
        id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2),
        _source: { calendarId: sub.id, uid: e.uid },
      }));
      Store._save([...others, ...fresh]);
      SubStore.updateSync(sub.id, new Date().toISOString(), null);
      SubModal.render();
      render();
    }

    async function syncAll() {
      const now = Date.now();
      for (const sub of SubStore.all()) {
        if (!sub.lastSync || now - new Date(sub.lastSync).getTime() > 86400000) {
          await syncSubscription(sub);
        }
      }
    }

    // ── Subscription Modal ─────────────────────────────────────────────────────
    const SubModal = {
      el: null,
      init() {
        this.el = document.getElementById('sub-modal');
        if (!this.el) return;
        document.getElementById('sub-modal-close').addEventListener('click',  () => this.close());
        document.getElementById('sub-modal-done').addEventListener('click',   () => this.close());
        document.getElementById('sub-add-btn').addEventListener('click',      () => this.addSub());
        document.getElementById('sub-sync-all-btn').addEventListener('click', () => this.doSyncAll());
        this.el.addEventListener('click', ev => { if (ev.target === this.el) this.close(); });
      },
      open()  { if (!this.el) return; this.render(); this.el.classList.add('open'); },
      close() { if (this.el) this.el.classList.remove('open'); },
      render() {
        const list = document.getElementById('sub-list');
        if (!list) return;
        const subs = SubStore.all();
        if (!subs.length) {
          list.innerHTML = '<div class="sub-empty">No calendars added yet. Add one below.</div>';
          return;
        }
        list.innerHTML = '';
        subs.forEach(sub => {
          const item = document.createElement('div'); item.className = 'sub-item';
          const dot  = document.createElement('div'); dot.className  = 'sub-item-dot';
          dot.style.background = PERSON_COLORS[sub.person] || '#7A9E7E';

          const info = document.createElement('div'); info.className = 'sub-item-info';
          const age   = sub.lastSync ? this._relTime(new Date(sub.lastSync)) : 'Never synced';
          const stCls = sub.error ? 'sync-err' : sub.lastSync ? 'sync-ok' : '';
          const stIco = sub.error ? '⚠' : sub.lastSync ? '✓' : '–';
          const errNote = sub.error ? `<span class="sub-err-note" title="${sub.error}"> · CORS?</span>` : '';
          info.innerHTML = `<div class="sub-item-name">${sub.name}</div>
            <div class="sub-item-meta"><span class="sub-sync-status ${stCls}">${stIco} ${age}</span>${errNote}</div>`;

          const actions = document.createElement('div'); actions.className = 'sub-item-actions';

          const syncBtn = document.createElement('button');
          syncBtn.className = 'btn btn-secondary sub-action-btn'; syncBtn.title = 'Sync now'; syncBtn.textContent = '↻';
          syncBtn.addEventListener('click', async () => {
            syncBtn.disabled = true; syncBtn.textContent = '…';
            await syncSubscription(sub);
            syncBtn.disabled = false; syncBtn.textContent = '↻';
          });

          const removeBtn = document.createElement('button');
          removeBtn.className = 'btn btn-danger sub-action-btn'; removeBtn.title = 'Remove'; removeBtn.textContent = '×';
          removeBtn.addEventListener('click', () => { SubStore.remove(sub.id); render(); this.render(); });

          actions.appendChild(syncBtn); actions.appendChild(removeBtn);
          item.appendChild(dot); item.appendChild(info); item.appendChild(actions);
          list.appendChild(item);
        });
      },
      async addSub() {
        const n = document.getElementById('sub-name-input');
        const u = document.getElementById('sub-url-input');
        const p = document.getElementById('sub-person-select');
        if (!n.value.trim()) { n.focus(); return; }
        if (!u.value.trim()) { u.focus(); return; }
        const sub = SubStore.add({ name: n.value.trim(), url: u.value.trim(), person: p.value });
        n.value = ''; u.value = '';
        this.render();
        await syncSubscription(sub);
      },
      async doSyncAll() {
        const btn = document.getElementById('sub-sync-all-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
        for (const sub of SubStore.all()) await syncSubscription(sub);
        if (btn) { btn.disabled = false; btn.textContent = 'Sync All'; }
      },
      _relTime(date) {
        const m = Math.floor((Date.now() - date) / 60000);
        if (m < 1)  return 'Just now';
        if (m < 60) return `${m}m ago`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h}h ago`;
        return `${Math.floor(h / 24)}d ago`;
      },
    };

    // ── Theme ──────────────────────────────────────────────────────────────────
    const Theme = {
      KEY: 'hsh_theme',
      init() {
        const saved = localStorage.getItem(this.KEY);
        if (saved) this.apply(saved);
        const btn = document.getElementById('cal-theme-btn');
        if (btn) btn.addEventListener('click', () => this.toggle());
      },
      apply(t) {
        document.documentElement.setAttribute('data-theme', t);
        const btn = document.getElementById('cal-theme-btn');
        if (btn) btn.textContent = t === 'dark' ? '☀️' : '🌙';
      },
      toggle() {
        const cur = document.documentElement.getAttribute('data-theme');
        const next = cur === 'dark' ? 'light' : 'dark';
        this.apply(next);
        localStorage.setItem(this.KEY, next);
      }
    };

    // ── View switching ─────────────────────────────────────────────────────────
    function setView(v) {
      ['month','week','day','agenda'].forEach(n => {
        const el = document.getElementById(`cal-${n}-view`);
        if (el) el.style.display = n === v ? '' : 'none';
      });
      document.querySelectorAll('.cal-view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
      S.view = v;
      render();
    }

    // ── Navigation ─────────────────────────────────────────────────────────────
    function navigate(delta) {
      if (S.view === 'month' || S.view === 'agenda') {
        S.current = new Date(S.y, S.m + delta, 1);
      } else if (S.view === 'week') {
        S.current = new Date(S.current.getTime() + delta * 7 * 86400000);
      } else {
        S.current = new Date(S.current.getTime() + delta * 86400000);
      }
      render();
    }

    // ── Bootstrap ──────────────────────────────────────────────────────────────
    function init() {
      seed();
      Theme.init();
      Modal.init();
      Confirm.init();
      SubModal.init();

      document.getElementById('cal-prev-btn').addEventListener('click', () => navigate(-1));
      document.getElementById('cal-next-btn').addEventListener('click', () => navigate(1));
      document.getElementById('cal-today-btn').addEventListener('click', () => { S.current = new Date(); render(); });
      document.getElementById('cal-subs-btn').addEventListener('click', () => SubModal.open());

      document.querySelectorAll('.cal-view-btn').forEach(btn =>
        btn.addEventListener('click', () => setView(btn.dataset.view))
      );

      document.getElementById('cal-search-input').addEventListener('input', function () {
        S.search = this.value; render();
      });

      document.querySelectorAll('.cat-chip').forEach(chip =>
        chip.addEventListener('click', function () {
          document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
          this.classList.add('active');
          S.cat = this.dataset.cat;
          render();
        })
      );

      document.addEventListener('keydown', ev => {
        const tag = ev.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (!document.getElementById('events').classList.contains('active')) return;
        if (ev.key === 'ArrowLeft')  navigate(-1);
        if (ev.key === 'ArrowRight') navigate(1);
        if (ev.key === 't' || ev.key === 'T') { S.current = new Date(); render(); }
        if (ev.key === 'Escape') { Modal.close(); Confirm.close(); SubModal.close(); }
        if (ev.key === 'm') setView('month');
        if (ev.key === 'w') setView('week');
        if (ev.key === 'd') setView('day');
        if (ev.key === 'a') setView('agenda');
      });

      render();
      syncAll();
    }

    // Lazy init: run when section becomes active, or immediately if already active
    window._calInit = init;
    if (document.getElementById('events') && document.getElementById('events').classList.contains('active')) {
      init();
    }
  })();

  // Patch showSection to init calendar on first open
  const _origShow = showSection;
  window.showSection = function(id) {
    _origShow && _origShow.call(this, id);
    if (id === 'events' && window._calInit) {
      window._calInit();
      window._calInit = null;
    }
  };
