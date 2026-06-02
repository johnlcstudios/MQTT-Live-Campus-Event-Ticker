import { sql } from '@vercel/postgres';
import { v4 as uuidv4 } from 'uuid';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    await migrate();
    const action = (req.query.slug || []).join('/');
    const input = req.body || {};

    switch (action) {

      // Admin setup
      case 'admin/setup': {
        const { username, password } = input;
        if (!username || !password) return error(res, 'Missing username or password', 400);
        const campusId = String(Math.floor(100000 + Math.random() * 900000));
        const r = await sql`INSERT INTO admins (username, password_hash, campus_id) VALUES (${username}, ${password}, ${campusId}) RETURNING id`;
        const id = r.rows[0].id;
        await sql`INSERT INTO masterlist_qr (admin_id, qr_token) VALUES (${id}, ${uuidv4()})`;
        return ok(res, { success: true, campus_id: campusId });
      }

      case 'admin/login': {
        const r = await sql`SELECT * FROM admins WHERE username = ${input.username} AND password_hash = ${input.password}`;
        if (!r.rows.length) return error(res, 'Invalid credentials', 401);
        const admin = r.rows[0];
        const token = generateToken();
        await sql`INSERT INTO tokens (token, admin_id, expires) VALUES (${token}, ${admin.id}, NOW() + INTERVAL '24 hours')`;
        return ok(res, { token, username: admin.username });
      }

      case 'admin/me': {
        const adminId = await getAuth(req);
        const r = await sql`SELECT id, username, campus_id FROM admins WHERE id = ${adminId}`;
        if (!r.rows.length) return error(res, 'Admin not found', 404);
        const qr = await sql`SELECT qr_token FROM masterlist_qr WHERE admin_id = ${adminId}`;
        return ok(res, { ...r.rows[0], masterQrToken: qr.rows[0]?.qr_token || null });
      }

      case 'events': {
        const adminId = await getAuth(req);
        let q = `SELECT e.*, (SELECT COUNT(*) FROM event_registrations WHERE event_id = e.id) as registrations FROM events e WHERE e.admin_id = $1`;
        const params = [adminId];
        if (req.query.from) { params.push(req.query.from); q += ` AND e.event_date >= $${params.length}`; }
        if (req.query.to) { params.push(req.query.to); q += ` AND e.event_date <= $${params.length}`; }
        q += ' ORDER BY e.event_date DESC';
        const r = await sql.query(q, params);
        return ok(res, { events: r.rows });
      }

      case 'create_event': {
        const adminId = await getAuth(req);
        const qrToken = uuidv4();
        const r = await sql`
          INSERT INTO events (admin_id, name, description, event_date, max_capacity, qr_token, reminder_minutes)
          VALUES (${adminId}, ${input.name}, ${input.description || null}, ${input.event_date}, ${input.max_capacity || 100}, ${qrToken}, ${input.reminder_minutes || null})
          RETURNING id
        `;
        return ok(res, { id: r.rows[0].id, qr_token: qrToken });
      }

      case 'delete_event': {
        const adminId = await getAuth(req);
        await sql`DELETE FROM events WHERE id = ${req.query.id} AND admin_id = ${adminId}`;
        return ok(res, { success: true });
      }

      case 'clone_event': {
        const adminId = await getAuth(req);
        const ev = await sql`SELECT * FROM events WHERE id = ${req.query.id} AND admin_id = ${adminId}`;
        if (!ev.rows.length) return error(res, 'Access denied', 403);
        const e = ev.rows[0];
        const qrToken = uuidv4();
        const r = await sql`INSERT INTO events (admin_id, name, description, event_date, max_capacity, qr_token) VALUES (${adminId}, ${e.name + ' (copy)'}, ${e.description}, ${e.event_date}, ${e.max_capacity}, ${qrToken}) RETURNING id`;
        return ok(res, { id: r.rows[0].id, qr_token: qrToken });
      }

      case 'event_students': {
        const adminId = await getAuth(req);
        const ev = await sql`SELECT id FROM events WHERE id = ${req.query.id} AND admin_id = ${adminId}`;
        if (!ev.rows.length) return error(res, 'Access denied', 403);
        const r = await sql`SELECT s.* FROM students s JOIN event_registrations er ON s.id = er.student_id WHERE er.event_id = ${req.query.id} ORDER BY er.registered_at DESC`;
        return ok(res, { students: r.rows });
      }

      case 'students': {
        const adminId = await getAuth(req);
        const search = req.query.search || '';
        if (search) {
          const r = await sql`SELECT * FROM students WHERE admin_id = ${adminId} AND (name ILIKE ${'%' + search + '%'} OR student_id_number ILIKE ${'%' + search + '%'}) ORDER BY enrolled_at DESC`;
          return ok(res, { students: r.rows });
        }
        const r = await sql`SELECT * FROM students WHERE admin_id = ${adminId} ORDER BY enrolled_at DESC`;
        return ok(res, { students: r.rows });
      }

      case 'delete_student': {
        const adminId = await getAuth(req);
        await sql`DELETE FROM event_registrations WHERE student_id = ${req.query.id}`;
        await sql`DELETE FROM students WHERE id = ${req.query.id} AND admin_id = ${adminId}`;
        return ok(res, { success: true });
      }

      case 'import_students': {
        const adminId = await getAuth(req);
        const lines = (input.csv || '').split('\n').filter(l => l.trim());
        let imported = 0;
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(',');
          if (parts.length < 2) continue;
          const name = parts[0].replace(/"/g, '').trim();
          const sid = parts[1].replace(/"/g, '').trim();
          if (!name || !sid) continue;
          try {
            await sql`INSERT INTO students (name, student_id_number, admin_id) VALUES (${name}, ${sid}, ${adminId}) ON CONFLICT DO NOTHING`;
            imported++;
          } catch {}
        }
        return ok(res, { success: true, imported });
      }

      case 'export_students_csv': {
        const adminId = await getAuth(req);
        const r = await sql`SELECT name, student_id_number, enrolled_at FROM students WHERE admin_id = ${adminId} ORDER BY enrolled_at DESC`;
        let csv = 'Name,Student ID,Enrolled At\n';
        r.rows.forEach(s => { csv += `"${s.name}","${s.student_id_number}","${s.enrolled_at}"\n`; });
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=students.csv');
        return res.status(200).send(csv);
      }

      case 'export_roster_csv': {
        const adminId = await getAuth(req);
        const r = await sql`
          SELECT s.name, s.student_id_number, er.registered_at FROM students s
          JOIN event_registrations er ON s.id = er.student_id
          WHERE er.event_id = ${req.query.id}
          ORDER BY er.registered_at DESC
        `;
        let csv = 'Name,Student ID,Registered At\n';
        r.rows.forEach(s => { csv += `"${s.name}","${s.student_id_number}","${s.registered_at}"\n`; });
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=roster.csv');
        return res.status(200).send(csv);
      }

      case 'student/ticker-data': {
        const { studentId, campusId } = req.query;
        if (!studentId || !campusId) return error(res, 'Missing identity credentials.');
        const admin = await sql`SELECT id FROM admins WHERE LOWER(REPLACE(TRIM(campus_id), ' ', '')) = LOWER(REPLACE(TRIM(${campusId}), ' ', '')) OR id::text = ${campusId}`;
        if (!admin.rows.length) return error(res, 'Campus ID not recognized.');
        const aid = admin.rows[0].id;
        const nsid = normalizeSid(studentId);
        const stu = await sql.query(
          `SELECT id, name FROM students WHERE LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(student_id_number), ' ', ''), '-', ''), '.', ''), '/', ''), '_', '')) = $1 AND admin_id = $2`,
          [nsid, aid]
        );
        if (!stu.rows.length) {
          const other = await sql.query(
            `SELECT 1 FROM students WHERE LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(student_id_number), ' ', ''), '-', ''), '.', ''), '/', ''), '_', '')) = $1`,
            [nsid]
          );
          if (other.rows.length) return error(res, 'This Student ID is registered on a different campus.');
          return error(res, 'Account not found. You must be enrolled via QR code first.', 404);
        }
        const student = stu.rows[0];
        const events = await sql.query(
          `SELECT e.id, e.name, e.description, e.event_date, e.max_capacity, e.qr_token,
           CASE WHEN er.id IS NOT NULL THEN 1 ELSE 0 END as registered,
           (SELECT COUNT(*) FROM event_registrations WHERE event_id = e.id) as registrations
           FROM events e
           LEFT JOIN event_registrations er ON e.id = er.event_id AND er.student_id = $1
           WHERE e.admin_id = $2 AND e.event_date > NOW() - INTERVAL '1 day'
           ORDER BY e.event_date ASC`,
          [student.id, aid]
        );
        const notifications = await sql.query(
          `SELECT n.*, a.username as admin_name, e.name as event_name FROM notifications_log n
           JOIN admins a ON n.admin_id = a.id
           LEFT JOIN events e ON n.target_id = e.id
           WHERE n.admin_id = $1 AND (n.target_type = 'masterlist' OR (n.target_type = 'event' AND n.target_id IN (SELECT event_id FROM event_registrations WHERE student_id = $2)))
           ORDER BY n.pinned DESC, n.sent_at DESC LIMIT 30`,
          [aid, student.id]
        );
        const settings = await sql`SELECT * FROM ticker_settings WHERE admin_id = ${aid}`;
        return ok(res, { id: aid, student_db_id: student.id, name: student.name, events: events.rows, notifications: notifications.rows, settings: settings.rows[0] || {} });
      }

      case 'resolve-token': {
        const ev = await sql`SELECT e.id, e.name, e.admin_id, a.campus_id, 'event' as type FROM events e JOIN admins a ON e.admin_id = a.id WHERE e.qr_token = ${req.query.token}`;
        if (ev.rows.length) return ok(res, ev.rows[0]);
        const ml = await sql`SELECT m.admin_id, a.campus_id, 'Masterlist Enrollment' as name, 'masterlist' as type FROM masterlist_qr m JOIN admins a ON m.admin_id = a.id WHERE m.qr_token = ${req.query.token}`;
        if (ml.rows.length) return ok(res, ml.rows[0]);
        return error(res, 'Invalid QR code', 404);
      }

      case 'enroll': {
        const { token, name, studentId } = input;
        const ev = await sql`SELECT id, name, admin_id, 'event' as type FROM events WHERE qr_token = ${token}`;
        const ml = await sql`SELECT admin_id, 'masterlist' as type FROM masterlist_qr WHERE qr_token = ${token}`;
        const target = ev.rows[0] || ml.rows[0];
        if (!target) return error(res, 'Invalid registration token', 404);
        const aid = target.admin_id;
        const nsid = normalizeSid(studentId);
        const stu = await sql.query(
          `SELECT id FROM students WHERE LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(student_id_number), ' ', ''), '-', ''), '.', ''), '/', ''), '_', '')) = $1 AND admin_id = $2`,
          [nsid, aid]
        );
        let studentDbId;
        if (stu.rows.length) {
          studentDbId = stu.rows[0].id;
        } else {
          const r = await sql`INSERT INTO students (name, student_id_number, admin_id) VALUES (${name}, ${studentId.trim()}, ${aid}) RETURNING id`;
          studentDbId = r.rows[0].id;
        }
        if (target.type === 'event') {
          await sql`INSERT INTO event_registrations (student_id, event_id) VALUES (${studentDbId}, ${target.id}) ON CONFLICT DO NOTHING`;
        }
        return ok(res, { success: true, student_db_id: studentDbId });
      }

      case 'unregister': {
        await sql`DELETE FROM event_registrations WHERE student_id = ${input.student_db_id} AND event_id = ${input.event_id}`;
        return ok(res, { success: true });
      }

      case 'update_profile': {
        await sql`UPDATE students SET name = ${input.name.trim()} WHERE id = ${input.student_db_id}`;
        return ok(res, { success: true });
      }

      case 'send_notification': {
        const adminId = await getAuth(req);
        if (!input.title || !input.body) return error(res, 'Missing title or body');
        const r = await sql`
          INSERT INTO notifications_log (admin_id, target_type, target_id, title, body, pinned)
          VALUES (${adminId}, ${input.target_type}, ${input.target_id || null}, ${input.title}, ${input.body}, ${input.pinned ? 1 : 0})
          RETURNING id
        `;
        const admin = await sql`SELECT campus_id FROM admins WHERE id = ${adminId}`;
        if (admin.rows[0]?.campus_id) {
          sendOneSignalPush(input.title, input.body, admin.rows[0].campus_id).catch(() => {});
        }
        return ok(res, { success: true, id: r.rows[0].id });
      }

      case 'toggle_pin': {
        const adminId = await getAuth(req);
        const n = await sql`SELECT id, pinned FROM notifications_log WHERE id = ${req.query.id} AND admin_id = ${adminId}`;
        if (!n.rows.length) return error(res, 'Access denied', 403);
        const newVal = n.rows[0].pinned ? 0 : 1;
        await sql`UPDATE notifications_log SET pinned = ${newVal} WHERE id = ${req.query.id}`;
        return ok(res, { success: true, pinned: !!newVal });
      }

      case 'notification_log': {
        const adminId = await getAuth(req);
        const r = await sql`
          SELECT n.*, e.name as event_name FROM notifications_log n
          LEFT JOIN events e ON n.target_id = e.id
          WHERE n.admin_id = ${adminId}
          ORDER BY n.pinned DESC, n.sent_at DESC LIMIT 50
        `;
        return ok(res, { logs: r.rows });
      }

      case 'edit_notification': {
        const adminId = await getAuth(req);
        const n = await sql`SELECT id FROM notifications_log WHERE id = ${input.id} AND admin_id = ${adminId}`;
        if (!n.rows.length) return error(res, 'Access denied', 403);
        const updates = [];
        const params = [];
        if (input.title !== undefined) { updates.push(`title = $${params.length + 1}`); params.push(input.title); }
        if (input.body !== undefined) { updates.push(`body = $${params.length + 1}`); params.push(input.body); }
        if (input.pinned !== undefined) { updates.push(`pinned = $${params.length + 1}`); params.push(input.pinned ? 1 : 0); }
        if (!updates.length) return error(res, 'No fields to update');
        params.push(input.id); params.push(adminId);
        await sql.query(`UPDATE notifications_log SET ${updates.join(', ')} WHERE id = $${params.length - 1} AND admin_id = $${params.length}`, params);
        return ok(res, { success: true });
      }

      case 'delete_notification': {
        const adminId = await getAuth(req);
        await sql`DELETE FROM notifications_log WHERE id = ${req.query.id} AND admin_id = ${adminId}`;
        return ok(res, { success: true });
      }

      case 'get_ticker_settings': {
        const adminId = await getAuth(req);
        const r = await sql`SELECT * FROM ticker_settings WHERE admin_id = ${adminId}`;
        if (!r.rows.length) {
          await sql`INSERT INTO ticker_settings (admin_id) VALUES (${adminId})`;
          return ok(res, { settings: defaults() });
        }
        return ok(res, { settings: r.rows[0] });
      }

      case 'update_ticker_settings': {
        const adminId = await getAuth(req);
        const s = { ...defaults(), ...input };
        await sql`
          INSERT INTO ticker_settings (admin_id, primary_color, accent_color, background_style, banner_text, banner_enabled, font_size, card_style, show_dates, show_descriptions, footer_text, animation_style, border_radius)
          VALUES (${adminId}, ${s.primary_color}, ${s.accent_color}, ${s.background_style}, ${s.banner_text}, ${s.banner_enabled ? 1 : 0}, ${s.font_size}, ${s.card_style}, ${s.show_dates ? 1 : 0}, ${s.show_descriptions ? 1 : 0}, ${s.footer_text}, ${s.animation_style}, ${s.border_radius})
          ON CONFLICT (admin_id) DO UPDATE SET
            primary_color = EXCLUDED.primary_color, accent_color = EXCLUDED.accent_color,
            background_style = EXCLUDED.background_style, banner_text = EXCLUDED.banner_text,
            banner_enabled = EXCLUDED.banner_enabled, font_size = EXCLUDED.font_size,
            card_style = EXCLUDED.card_style, show_dates = EXCLUDED.show_dates,
            show_descriptions = EXCLUDED.show_descriptions, footer_text = EXCLUDED.footer_text,
            animation_style = EXCLUDED.animation_style, border_radius = EXCLUDED.border_radius
        `;
        return ok(res, { success: true });
      }

      case 'public-events': {
        const r = await sql`
          SELECT e.id, e.name, e.description, e.event_date, a.username as admin_name
          FROM events e JOIN admins a ON e.admin_id = a.id
          WHERE e.event_date > NOW() - INTERVAL '1 day'
          ORDER BY e.event_date ASC LIMIT 10
        `;
        return ok(res, { events: r.rows });
      }

      case 'check_reminders': {
        const reminders = await sql`
          SELECT e.* FROM events e
          WHERE e.reminder_minutes IS NOT NULL
          AND e.event_date - (e.reminder_minutes || ' minutes')::interval <= NOW()
          AND e.event_date > NOW()
          AND e.id NOT IN (SELECT event_id FROM event_reminders_sent)
        `;
        for (const ev of reminders.rows) {
          await sql`INSERT INTO notifications_log (admin_id, target_type, target_id, title, body) VALUES (${ev.admin_id}, 'event', ${ev.id}, ${'Reminder: ' + ev.name}, ${'"' + ev.name + '" starts in ' + ev.reminder_minutes + ' minutes!'})`;
          await sql`INSERT INTO event_reminders_sent (event_id) VALUES (${ev.id})`;
        }
        return ok(res, { success: true, checked: reminders.rows.length });
      }

      default:
        return error(res, 'Unknown action: ' + action, 404);
    }
  } catch (e) {
    console.error('API error:', e);
    return error(res, e.message, 500);
  }
}

// ─── HELPERS ───

function ok(res, data) { return res.status(200).json(data); }
function error(res, msg, code = 400) { return res.status(code).json({ error: msg }); }
function generateToken() {
  const chars = 'abcdef0123456789';
  return Array.from({ length: 64 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
function normalizeSid(sid) {
  return sid.trim().toLowerCase().replace(/[\s\-.\/_]/g, '');
}
function defaults() {
  return {
    primary_color: '#3b82f6', accent_color: '#10b981', background_style: 'dark',
    banner_text: '', banner_enabled: false, font_size: 'medium', card_style: 'card',
    show_dates: true, show_descriptions: true, footer_text: '', animation_style: 'fade', border_radius: 12
  };
}

async function getAuth(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/);
  if (!match) throw new Error('No token provided');
  const r = await sql`SELECT admin_id FROM tokens WHERE token = ${match[1]} AND expires > NOW()`;
  if (!r.rows.length) throw new Error('Invalid or expired token');
  return r.rows[0].admin_id;
}

async function migrate() {
  await sql`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      campus_id TEXT UNIQUE,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      admin_id INTEGER NOT NULL REFERENCES admins(id),
      name TEXT NOT NULL,
      description TEXT,
      event_date TIMESTAMPTZ NOT NULL,
      max_capacity INTEGER DEFAULT 100,
      qr_token TEXT UNIQUE NOT NULL,
      reminder_minutes INTEGER DEFAULT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS masterlist_qr (
      id SERIAL PRIMARY KEY,
      admin_id INTEGER UNIQUE NOT NULL REFERENCES admins(id),
      qr_token TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      student_id_number TEXT NOT NULL,
      admin_id INTEGER NOT NULL REFERENCES admins(id),
      enrolled_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(student_id_number, admin_id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS event_registrations (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id),
      event_id INTEGER NOT NULL REFERENCES events(id),
      registered_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(student_id, event_id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS notifications_log (
      id SERIAL PRIMARY KEY,
      admin_id INTEGER NOT NULL REFERENCES admins(id),
      target_type TEXT NOT NULL,
      target_id INTEGER,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      pinned INTEGER DEFAULT 0,
      sent_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS event_reminders_sent (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES events(id),
      sent_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS ticker_settings (
      id SERIAL PRIMARY KEY,
      admin_id INTEGER UNIQUE NOT NULL REFERENCES admins(id),
      primary_color TEXT DEFAULT '#3b82f6',
      accent_color TEXT DEFAULT '#10b981',
      background_style TEXT DEFAULT 'dark',
      banner_text TEXT DEFAULT '',
      banner_enabled INTEGER DEFAULT 0,
      font_size TEXT DEFAULT 'medium',
      card_style TEXT DEFAULT 'card',
      show_dates INTEGER DEFAULT 1,
      show_descriptions INTEGER DEFAULT 1,
      footer_text TEXT DEFAULT '',
      animation_style TEXT DEFAULT 'fade',
      border_radius INTEGER DEFAULT 12
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS tokens (
      token TEXT PRIMARY KEY,
      admin_id INTEGER NOT NULL REFERENCES admins(id),
      expires TIMESTAMPTZ NOT NULL
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_events_admin ON events(admin_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_students_admin ON students(admin_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_reg_event ON event_registrations(event_id)`;
}

async function sendOneSignalPush(title, body, campusId) {
  const appId = process.env.ONESIGNAL_APP_ID || 'f426ca4c-6613-4a39-988b-ddb6dcf34304';
  const restKey = process.env.ONESIGNAL_REST_KEY;
  if (!restKey) return;
  const payload = {
    app_id: appId,
    headings: { en: title },
    contents: { en: body },
    channel_for_external_user_ids: 'push',
  };
  if (campusId) {
    payload.filters = [{ field: 'tag', key: 'campus_id', relation: '=', value: campusId }];
  } else {
    payload.included_segments = ['Active Users'];
  }
  try {
    await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${restKey}` },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error('OneSignal push error:', e);
  }
}
