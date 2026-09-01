// Populates the real SQLite database with the ZOU org structure, accounts,
// and starter KPIs. Safe to re-run: it wipes and rebuilds every table, so use
// it for first-time setup or to reset the demo data — not on a live system
// with real submitted data you want to keep.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');
const { PERMISSIONS, DEFAULT_PERMS_BY_ROLE } = require('./utils/permissions');
const { emailFor } = require('./utils/email');

const DEMO_PASSWORD = process.env.SEED_PASSWORD || 'Zou@2026';

const txn = db.transaction(() => {
  console.log('Wiping existing data...');
  db.exec(`
    DELETE FROM message_recipients; DELETE FROM messages;
    DELETE FROM plan_proposals; DELETE FROM kpi_assignments; DELETE FROM structural_proposals;
    DELETE FROM audit_log; DELETE FROM kpi_values; DELETE FROM kpis;
    DELETE FROM individuals; DELETE FROM units; DELETE FROM subs; DELETE FROM programmes;
    DELETE FROM user_permissions; DELETE FROM users; DELETE FROM permissions; DELETE FROM settings;
  `);

  console.log('Seeding permission catalog...');
  const insertPerm = db.prepare('INSERT INTO permissions (key, label, group_name) VALUES (?, ?, ?)');
  PERMISSIONS.forEach((p) => insertPerm.run(p.key, p.label, p.group));

  console.log('Seeding settings...');
  const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run('ragGreen', '80');
  insertSetting.run('ragAmber', '50');
  insertSetting.run('lateCutoffIndividual', '3');
  insertSetting.run('lateCutoffUnit', '5');
  insertSetting.run('lateCutoffSub', '7');
  insertSetting.run('escalateProgramme', '6');
  insertSetting.run('escalateVC', '11');
  insertSetting.run('redEscalateProgramme', '2');
  insertSetting.run('redEscalateVC', '4');

  const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  const insertUser = db.prepare(
    'INSERT INTO users (name, title, email, password_hash, role, scope_type, scope_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const setPerms = db.prepare('INSERT INTO user_permissions (user_id, permission_key) VALUES (?, ?)');
  function makeUser(name, title, role, scopeType, scopeId, permsOverride) {
    const email = emailFor(name);
    const id = insertUser.run(name, title, email, passwordHash, role, scopeType, scopeId).lastInsertRowid;
    const perms = permsOverride || DEFAULT_PERMS_BY_ROLE[role] || [];
    perms.forEach((k) => setPerms.run(id, k));
    return id;
  }

  console.log('Seeding executive & admin accounts...');
  // The Vice Chancellor is this university's Executive Owner — the one
  // account structurally accountable for overall institutional performance
  // against the Plan (see users.is_executive_owner / routes/org.js's GET /,
  // which exposes this to every signed-in account, and Overview.jsx's
  // "Overall Institutional Performance" card). A real designation, not just
  // a job title: it's what the app itself points to when it says who owns
  // that number.
  const vcId = makeUser('Prof. L. Chareka', 'Vice Chancellor', 'exec', null, null);
  db.prepare('UPDATE users SET is_executive_owner = 1 WHERE id = ?').run(vcId);
  // University Council: the final validation/approval authority over the
  // compiled University Annual Plan, above CPU's own compile-and-submit
  // step — see routes/plans.js's POST /university/approve|return. A real
  // account tier (role='council'), not a relabeled Executive — read-only
  // everywhere else in the app (DEFAULT_PERMS_BY_ROLE.council), the one
  // thing this account can actually do is validate and either approve
  // (putting it into effect) or return the Annual Plan once CPU submits it.
  makeUser('Mr. F. Museta', 'Council Chairperson', 'council', null, null);
  const cpuId = makeUser('T. Moyo', 'Corporate Planning Unit', 'cpu', null, null);
  const ictId = makeUser('L. Chikomo', 'ICT Systems Administrator', 'ictadmin', null, null);

  console.log('Seeding programmes, sub-programmes, units, individuals...');
  const insertProgramme = db.prepare('INSERT INTO programmes (name, head) VALUES (?, ?)');
  const insertSub = db.prepare('INSERT INTO subs (programme_id, name, head, unit_label, rep_user_id) VALUES (?, ?, ?, ?, ?)');
  const insertUnit = db.prepare('INSERT INTO units (sub_id, name, head, kind, head_user_id) VALUES (?, ?, ?, ?, ?)');
  const insertIndividual = db.prepare('INSERT INTO individuals (unit_id, name, role_title, user_id) VALUES (?, ?, ?, ?)');

  const pGovId = insertProgramme.run('Governance & Administration', 'Mr. S. Chitiyo — DVC Administration').lastInsertRowid;
  const pHcdId = insertProgramme.run('Human Capital Development', 'Prof. B. Manyanga — DVC Academic').lastInsertRowid;
  const pRiiId = insertProgramme.run('Research, Innovation & Industrialisation', 'Prof. E. Mavhunga — DVC Research & Innovation').lastInsertRowid;

  // Each Programme's own head gets a real login account — a genuine
  // 'programme' role scoped (scope_type/scope_id) to that Programme only,
  // same pattern as every Sub-programme Rep / Unit Head account above. The
  // Programme's own free-text `head` field (already the exact name used
  // here) becomes this account's name, so "who leads this Programme" reads
  // the same in the org chart and in the account directory.
  const PROGRAMME_HEADS = [
    { programme: pGovId, name: 'Mr. S. Chitiyo', title: 'DVC Administration — Programme Head, Governance & Administration' },
    { programme: pHcdId, name: 'Prof. B. Manyanga', title: 'DVC Academic — Programme Head, Human Capital Development' },
    { programme: pRiiId, name: 'Prof. E. Mavhunga', title: 'DVC Research & Innovation — Programme Head, Research, Innovation & Industrialisation' },
  ];
  PROGRAMME_HEADS.forEach((ph) => {
    const headUserId = makeUser(ph.name, ph.title, 'programme', 'programme', ph.programme);
    db.prepare('UPDATE programmes SET head_user_id = ? WHERE id = ?').run(headUserId, ph.programme);
  });

  const SUBS_SEED = [
    { key: 's1', programme: pGovId, name: 'Administration', head: 'Mr. T. Muzawazi — Director, Administration', rep: 'P. Marecha (Administration Officer)', unitLabel: 'Department' },
    { key: 's2', programme: pGovId, name: 'Financial Services', head: 'Mrs. C. Nyoni — Director, Finance', rep: 'L. Sithole (Finance Officer)', unitLabel: 'Department' },
    { key: 's3', programme: pGovId, name: 'ICT', head: 'Eng. T. Marufu — Director, ICT', rep: 'B. Gwatidzo (ICT Planning Officer)', unitLabel: 'Unit' },
    { key: 's4', programme: pGovId, name: 'Governance', head: 'Mr. W. Dube — Registrar', rep: 'S. Mapfumo (Governance Officer)', unitLabel: 'Unit' },
    { key: 's5', programme: pHcdId, name: 'Teaching & Learning', head: 'Prof. B. Manyanga — DVC Academic', rep: 'F. Mutasa (Planning Officer, T&L)', unitLabel: 'Faculty' },
    { key: 's6', programme: pHcdId, name: 'Library & Information Services', head: 'Ms. R. Ncube — University Librarian', rep: 'N. Chivasa (Library Officer)', unitLabel: 'Unit' },
    { key: 's7', programme: pRiiId, name: 'Research', head: 'Prof. K. Gumbo — Director, Research', rep: 'P. Sibanda (Research Officer)', unitLabel: 'Unit' },
    { key: 's8', programme: pRiiId, name: 'Innovation & Enterprises', head: 'Mr. K. Chikafu — Director, Innovation & Enterprises', rep: 'T. Zulu (Innovation Officer)', unitLabel: 'Unit' },
  ];
  const subIds = {};
  SUBS_SEED.forEach((s) => {
    const repUserId = makeUser(s.rep, `Sub-programme Rep — ${s.name}`, 'rep', 'sub', null);
    const id = insertSub.run(s.programme, s.name, s.head, s.unitLabel, repUserId).lastInsertRowid;
    db.prepare('UPDATE users SET scope_id = ? WHERE id = ?').run(id, repUserId);
    subIds[s.key] = id;
  });

  const UNITS_SEED = [
    { key: 'u1', sub: 's1', name: 'Registry', head: 'Mrs. P. Chikonzo — Registry Manager' },
    { key: 'u2', sub: 's1', name: 'Human Resources', head: 'Mr. F. Mangwiro — HR Manager' },
    { key: 'u3', sub: 's2', name: 'Bursary Office', head: 'Mrs. J. Mutandwa — Bursar' },
    { key: 'u4', sub: 's2', name: 'Procurement Office', head: 'Mr. D. Kanyimo — Procurement Manager' },
    { key: 'u5', sub: 's3', name: 'Network Infrastructure Unit', head: 'Mr. R. Chinamasa — Network Manager' },
    { key: 'u6', sub: 's3', name: 'LMS Support Unit', head: 'Ms. V. Mafuta — LMS Support Manager' },
    { key: 'u7', sub: 's4', name: 'Legal & Compliance Office', head: 'Mrs. G. Chitando — Legal Officer' },
    { key: 'u8', sub: 's4', name: 'Council Secretariat', head: 'Mr. E. Mabhena — Council Secretary' },
    { key: 'u9', sub: 's5', name: 'Faculty of Arts & Education', head: 'Prof. L. Mazango — Dean, Arts & Education' },
    { key: 'u10', sub: 's5', name: 'Faculty of Commerce & Law', head: 'Prof. S. Chiweshe — Dean, Commerce & Law' },
    { key: 'u11', sub: 's6', name: 'Regional Library Services', head: 'Mrs. A. Mutepfa — Regional Libraries Manager' },
    { key: 'u12', sub: 's6', name: 'Digital Repository Unit', head: 'Mr. C. Nyathi — Digital Repository Manager' },
    { key: 'u13', sub: 's7', name: 'Postgraduate Research Unit', head: 'Dr. M. Chirisa — Postgraduate Research Coordinator' },
    { key: 'u14', sub: 's7', name: 'Grants & Ethics Office', head: 'Dr. F. Rusike — Grants & Ethics Officer' },
    { key: 'u15', sub: 's8', name: 'Innovation Hub', head: 'Mr. T. Mudimu — Innovation Hub Manager' },
    { key: 'u16', sub: 's8', name: 'Enterprise Development Unit', head: 'Ms. N. Gutu — Enterprise Development Manager' },
  ];
  const unitIds = {};
  UNITS_SEED.forEach((u) => {
    const headUserId = makeUser(u.head, `Unit Head — ${u.name}`, 'unithead', 'unit', null);
    const id = insertUnit.run(subIds[u.sub], u.name, u.head, 'Unit', headUserId).lastInsertRowid;
    db.prepare('UPDATE users SET scope_id = ? WHERE id = ?').run(id, headUserId);
    unitIds[u.key] = id;
  });

  const INDIVIDUALS_SEED = [
    { key: 'i1', unit: 'u9', name: 'T. Chikwanha', role: 'Programme Coordinator' },
    { key: 'i2', unit: 'u1', name: 'R. Chidziva', role: 'Student Records Officer' },
    { key: 'i3', unit: 'u13', name: 'Dr. N. Moyana', role: 'Postgraduate Coordinator' },
    { key: 'i4', unit: 'u6', name: 'S. Chikafu', role: 'Systems Support Officer' },
  ];
  const individualIds = {};
  INDIVIDUALS_SEED.forEach((ind) => {
    const userId = makeUser(ind.name, ind.role, 'individual', 'individual', null);
    const id = insertIndividual.run(unitIds[ind.unit], ind.name, ind.role, userId).lastInsertRowid;
    db.prepare('UPDATE users SET scope_id = ? WHERE id = ?').run(id, userId);
    individualIds[ind.key] = id;
  });

  console.log('Seeding KPIs...');
  const insertKpi = db.prepare(
    'INSERT INTO kpis (owner_type, owner_id, name, type, measure, baseline, target, is_automated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const KPIS_SEED = [
    ['sub', 's1', 'Student Records Digitised', 'Output', '%', 55, 90],
    ['sub', 's1', 'Staff Establishment Positions Filled', 'Outcome', '%', 78, 95],
    ['sub', 's2', 'Fee Revenue Collection Rate', 'Outcome', '%', 68, 85],
    ['sub', 's2', 'Audit Queries Resolved', 'Output', '%', 50, 100],
    ['sub', 's3', 'Core University Systems Uptime', 'Outcome', '%', 96.5, 99.5, 1],
    ['sub', 's3', 'ICT Support Tickets Resolved within SLA', 'Output', '%', 72, 95],
    ['sub', 's4', 'Statutory & Compliance Reports Submitted on Time', 'Output', '%', 80, 100],
    ['sub', 's4', 'Council Resolutions Implemented', 'Outcome', '%', 60, 90],
    ['sub', 's5', 'Student Enrolment (cumulative)', 'Outcome', 'students', 14200, 16000],
    ['sub', 's5', 'Graduate Employability Rate', 'Outcome', '%', 58, 75],
    ['sub', 's6', 'E-Resources Accessible Online', 'Output', '%', 60, 90],
    ['sub', 's6', 'Library User Satisfaction', 'Outcome', '%', 65, 85],
    ['sub', 's7', 'Peer-Reviewed Research Publications', 'Outcome', 'publications', 45, 90],
    ['sub', 's7', 'Postgraduate Students Graduating', 'Output', 'students', 25, 45],
    ['sub', 's8', 'Innovations Commercialised', 'Outcome', 'innovations', 3, 10],
    ['sub', 's8', 'Industry Partnerships Established', 'Output', 'partnerships', 8, 20],
    ['unit', 'u1', 'Student Queries Resolved within SLA', 'Output', '%', 70, 95],
    ['unit', 'u2', 'Staff Performance Appraisals Completed', 'Output', '%', 55, 100],
    ['unit', 'u3', 'Student Fee Statements Issued on Time', 'Output', '%', 75, 98],
    ['unit', 'u4', 'Procurement Requests Processed within SLA', 'Output', '%', 60, 90],
    ['unit', 'u5', 'Network Uptime', 'Outcome', '%', 92, 99, 1],
    ['unit', 'u6', 'LMS Helpdesk Tickets Closed within SLA', 'Output', '%', 68, 95],
    ['unit', 'u7', 'Contracts Reviewed within SLA', 'Output', '%', 65, 95],
    ['unit', 'u8', 'Council & Senate Meetings Serviced', 'Output', '%', 85, 100],
    ['unit', 'u9', 'Programme Review Completion', 'Output', '%', 30, 100],
    ['unit', 'u10', 'Industry Attachment Placements', 'Output', 'placements', 80, 150],
    ['unit', 'u11', 'Library Materials Catalogued', 'Output', '%', 40, 100],
    ['unit', 'u12', 'Digital Theses Uploaded', 'Output', 'theses', 120, 300],
    ['unit', 'u13', 'Postgraduate Supervision Completion Rate', 'Output', '%', 50, 90],
    ['unit', 'u14', 'Research Grants Secured', 'Output', 'USD', 120000, 300000],
    ['unit', 'u15', 'Innovation Projects Incubated', 'Output', 'projects', 4, 12],
    ['unit', 'u16', 'Revenue from University Enterprises', 'Outcome', 'USD', 80000, 200000],
    ['individual', 'i1', 'Students Mentored to Completion', 'Output', 'students', 15, 25],
    ['individual', 'i2', 'Student Records Processed', 'Output', 'records', 200, 350],
    ['individual', 'i3', 'Postgraduate Theses Reviewed', 'Output', 'theses', 4, 10],
    ['individual', 'i4', 'Support Tickets Closed within SLA (personal)', 'Output', '%', 75, 95],
  ];
  const idMaps = { sub: subIds, unit: unitIds, individual: individualIds };
  const kpiIds = [];
  KPIS_SEED.forEach(([ownerType, ownerKey, name, type, measure, baseline, target, isAutomated]) => {
    const ownerId = idMaps[ownerType][ownerKey];
    const id = insertKpi.run(ownerType, ownerId, name, type, measure, baseline, target, isAutomated ? 1 : 0).lastInsertRowid;
    kpiIds.push(id);
  });

  console.log('Seeding a starter monthly value (current month, draft, empty) per KPI...');
  const insertValue = db.prepare(
    'INSERT INTO kpi_values (kpi_id, year, month, value, status) VALUES (?, ?, ?, NULL, \'draft\')'
  );
  const now = new Date();
  kpiIds.forEach((id) => insertValue.run(id, now.getFullYear(), now.getMonth() + 1));

  console.log('Seeding audit log entries for setup...');
  const insertAudit = db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)');
  insertAudit.run(ictId, 'seed', 'system', null, 'Database seeded with initial org structure, accounts, and KPIs.');

  console.log('Done. Demo login: any seeded email + password "' + DEMO_PASSWORD + '".');
  console.log('e.g. t.moyo@zou.ac.zw (CPU), l.chikomo@zou.ac.zw (ICT Admin), l.chareka@zou.ac.zw (VC / Executive Owner), f.museta@zou.ac.zw (University Council).');
});

txn();
