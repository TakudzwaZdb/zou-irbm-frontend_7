// Creates the starter ZOU org structure, accounts, and KPIs on an empty
// database. Pass --reset only to deliberately rebuild demo data; never use
// that mode on a production database.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');
const { PERMISSIONS, DEFAULT_PERMS_BY_ROLE } = require('./utils/permissions');
const DASHBOARD_OUTPUT_KPIS = require('./data/dashboardOutputs');
// ZOU email convention: surname + first-name initial (e.g. Takudzwa Zuze -> zuzet@zou.ac.zw).
// Titles and post-name descriptions are ignored. Ambiguous one-token names use the
// surname only; duplicate addresses are rejected below rather than silently altered.
function emailFor(fullName) {
  const clean = String(fullName || '')
    .replace(/\([^)]*\)/g, ' ')
    .split(/[—–-]/)[0]
    .replace(/\b(Mr|Mrs|Ms|Miss|Dr|Prof|Professor|Eng|Engineer|Rev|Reverend)\.?\b/gi, ' ')
    .replace(/[^A-Za-z.\s'-]/g, ' ')
    .trim();
  const parts = clean.split(/[\s.]+/).filter(Boolean);
  if (!parts.length) throw new Error(`Cannot derive email from name: ${fullName}`);
  const surname = parts[parts.length - 1].toLowerCase().replace(/[^a-z]/g, '');
  const firstInitial = parts.length > 1 ? parts[0][0].toLowerCase() : '';
  if (!surname) throw new Error(`Cannot derive surname for email: ${fullName}`);
  return `${surname}${firstInitial}@zou.ac.zw`;
}

const RESET_SEED = process.argv.includes('--reset');
const DEMO_PASSWORD = process.env.SEED_PASSWORD || 'Zou@2026';

const txn = db.transaction(async () => {
  if (!RESET_SEED) {
    await db.prepare('SELECT pg_advisory_xact_lock(?)').get(20261117);
    const existingData = await db.prepare(`
      SELECT
        EXISTS (SELECT 1 FROM users)
        OR EXISTS (SELECT 1 FROM programmes)
        OR EXISTS (SELECT 1 FROM subs)
        OR EXISTS (SELECT 1 FROM units)
        OR EXISTS (SELECT 1 FROM employees)
        OR EXISTS (SELECT 1 FROM kpis)
        OR EXISTS (SELECT 1 FROM kpi_values)
        OR EXISTS (SELECT 1 FROM kpi_contributions)
        OR EXISTS (SELECT 1 FROM kpi_assignments)
        OR EXISTS (SELECT 1 FROM kpi_templates)
        OR EXISTS (SELECT 1 FROM kpi_hidden)
        OR EXISTS (SELECT 1 FROM plan_proposals)
        OR EXISTS (SELECT 1 FROM structural_proposals)
        OR EXISTS (SELECT 1 FROM messages)
        OR EXISTS (SELECT 1 FROM message_recipients)
        OR EXISTS (SELECT 1 FROM mfa_recovery_codes)
        OR EXISTS (
          SELECT 1 FROM settings
          WHERE key NOT IN ('kpiLifecycleBackfillDone', 'alertWarningGap', 'alertCriticalGap')
        )
        OR EXISTS (SELECT 1 FROM audit_log)
        OR EXISTS (SELECT 1 FROM role_definitions WHERE built_in = 0)
        AS has_data
    `).get();
    if (existingData.has_data) {
      throw new Error('The database already contains application data. Initial setup only runs on an empty database; use the app to preserve existing data.');
    }
    console.log('Initializing the empty database schema and starter data...');
  } else {
    console.log('Reset mode enabled: wiping existing data...');
  }

  await db.exec(`
    DELETE FROM message_recipients; DELETE FROM messages;
    DELETE FROM plan_proposals; DELETE FROM kpi_assignments; DELETE FROM structural_proposals;
    DELETE FROM audit_log; DELETE FROM kpi_values; DELETE FROM kpis;
    DELETE FROM employees; DELETE FROM units; DELETE FROM subs; DELETE FROM programmes;
    DELETE FROM role_permissions; DELETE FROM user_permissions; DELETE FROM users; DELETE FROM permissions; DELETE FROM settings;
  `);

  console.log('Seeding permission catalog...');
  const insertPerm = db.prepare('INSERT OR IGNORE INTO permissions (key, label, group_name) VALUES (?, ?, ?)');
  for (const p of PERMISSIONS) await insertPerm.run(p.key, p.label, p.group);

  const insertRolePerm = db.prepare('INSERT OR IGNORE INTO role_permissions (role_key, permission_key) VALUES (?, ?)');
  const roleDefs = await db.prepare('SELECT key FROM role_definitions').all();
  for (const role of roleDefs) {
    for (const key of (DEFAULT_PERMS_BY_ROLE[role.key] || [])) await insertRolePerm.run(role.key, key);
  }

  console.log('Seeding settings...');
  const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  await insertSetting.run('ragGreen', '80');
  await insertSetting.run('ragAmber', '50');
  await insertSetting.run('lateCutoffEmployee', '3');
  await insertSetting.run('lateCutoffUnit', '5');
  await insertSetting.run('lateCutoffSub', '7');
  await insertSetting.run('escalateProgramme', '6');
  await insertSetting.run('escalateVC', '11');
  await insertSetting.run('redEscalateProgramme', '2');
  await insertSetting.run('redEscalateVC', '4');
  await insertSetting.run('alertWarningGap', '10');
  await insertSetting.run('alertCriticalGap', '25');
  await insertSetting.run('submissionOpenDay', '25');
  await insertSetting.run('submissionCloseDay', '3');

  const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  const insertUser = db.prepare(
    'INSERT INTO users (name, title, email, password_hash, role, scope_type, scope_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const setPerms = db.prepare('INSERT INTO user_permissions (user_id, permission_key) VALUES (?, ?)');
  const usedEmails = new Map();
  async function makeUser(name, title, role, scopeType, scopeId, permsOverride) {
    const email = emailFor(name);
    if (usedEmails.has(email)) {
      throw new Error(`Duplicate generated email ${email}: \"${usedEmails.get(email)}\" and \"${name}\". Resolve the name ambiguity before seeding.`);
    }
    usedEmails.set(email, name);
    const { lastInsertRowid: id } = await insertUser.run(name, title, email, passwordHash, role, scopeType, scopeId);
    const perms = permsOverride || DEFAULT_PERMS_BY_ROLE[role] || [];
    for (const k of perms) await setPerms.run(id, k);
    return id;
  }

  console.log('Seeding ZOU executive management and actual organisational hierarchy...');

  const insertProgramme = db.prepare('INSERT INTO programmes (name, head) VALUES (?, ?)');
  const insertSub = db.prepare('INSERT INTO subs (programme_id, name, head, unit_label, rep_user_id) VALUES (?, ?, ?, ?, ?)');
  const insertUnit = db.prepare('INSERT INTO units (sub_id, name, head, kind, head_user_id) VALUES (?, ?, ?, ?, ?)');
  const insertEmployee = db.prepare('INSERT INTO employees (unit_id, name, role_title, user_id) VALUES (?, ?, ?, ?)');

  // Executive leadership: the Vice Chancellor remains the institutional owner.
  const vcId = await makeUser('Dr. Mutanho', 'Vice Chancellor', 'vc', null, null);
  await db.prepare('UPDATE users SET is_executive_owner = 1 WHERE id = ?').run(vcId);
  const executiveAccounts = [
  ['Mr. Tom', 'Bursar'],
  ['Dr. P. Kahwema', 'Director, Academic Affairs'],
];

for (const [name, title] of executiveAccounts) {
  await makeUser(name, title, 'employee', null, null);
}

// ICT Systems Administrator
// Sandy Goreraza receives the dedicated ICT administrator role.
const ictAdminId = await makeUser(
  'Sandy Goreraza',
  'ICT Systems Administrator',
  'ictadmin',
  null,
  null
);
// Corporate Planning Unit (CPU)
// All four CPU members share exactly the same permission bundle.
// Permissions are inherited from DEFAULT_PERMS_BY_ROLE.cpu.

console.log('Seeding Corporate Planning Unit members...');

const CPU_MEMBERS = [
  'Dr P Mutanho',
  'Mr F Chabata',
  'Ms N Kupara',
  'Miss F Dengu',
];

const cpuPermissions = DEFAULT_PERMS_BY_ROLE.cpu;

if (!cpuPermissions || cpuPermissions.length === 0) {
  throw new Error(
    'CPU permissions are missing from DEFAULT_PERMS_BY_ROLE in utils/permissions.js'
  );
}

for (const name of CPU_MEMBERS) {
  await makeUser(
    name,
    'Corporate Planning Unit Member',
    'cpu',
    null,
    null,
    cpuPermissions
  );
}
  // Programme heads are mapped to the supplied leadership designations.
  const pGovId = (await insertProgramme.run('Governance and Administration', 'Mr. Murehwa — Registrar')).lastInsertRowid;
  const pHcdId = (await insertProgramme.run('Human Capital Development', 'Dr. Kahwema — Pro-Vice Chancellor, Academic Affairs')).lastInsertRowid;
  const pRiiId = (await insertProgramme.run('Research, Innovation and Industrialisation', 'Mr. Mutyasira — Pro-Vice Chancellor, Research, Innovation and Enterprise Development')).lastInsertRowid;
  const programmeHeads = [
    { id: pGovId, name: 'Mr. Murehwa', title: 'Registrar — Programme Head, Governance and Administration' },
    { id: pHcdId, name: 'Dr. Kahwema', title: 'Pro-Vice Chancellor, Academic Affairs — Programme Head, Human Capital Development' },
    { id: pRiiId, name: 'Mr. Mutyasira', title: 'Pro-Vice Chancellor, Research, Innovation and Enterprise Development — Programme Head, Research, Innovation and Industrialisation' },
  ];
  for (const ph of programmeHeads) {
    const headUserId = await makeUser(ph.name, ph.title, 'programme', 'programme', ph.id);
    await db.prepare('UPDATE programmes SET head_user_id = ? WHERE id = ?').run(headUserId, ph.id);
  }

  // The three strategic programmes contain the supplied sub-programme groupings.
  // Research-related categories are retained as separate sub-programmes pending
  // any later confirmation that some should instead be units.
  const SUBS_SEED = [
    { key: 's1', programme: pGovId, name: 'Administration', head: 'Mr. Murehwa — Registrar', unitLabel: 'Department' },
    { key: 's2', programme: pGovId, name: 'Bursary', head: 'Mr. Tom — Bursar', unitLabel: 'Department' },
    { key: 's3', programme: pGovId, name: 'Governance and Corporate Services', head: 'Mr. Murehwa — Registrar', unitLabel: 'Unit' },
    { key: 's4', programme: pGovId, name: 'ICT and Digital Services', head: 'Eng. M. Mvenge — Director, ICT', unitLabel: 'Unit' },
    { key: 's5', programme: pHcdId, name: 'Teaching and Learning', head: 'Dr. Kahwema — Pro-Vice Chancellor, Academic Affairs', unitLabel: 'Faculty' },
    { key: 's6', programme: pHcdId, name: 'Library and Information Services', head: 'Mr. Madziwo — Librarian', unitLabel: 'Unit' },
    { key: 's7', programme: pRiiId, name: 'Research and Postgraduate Studies', head: 'Mr. Mutyoraringa — Pro-Vice Chancellor, Research, Innovation and Enterprise Development', unitLabel: 'Unit' },
    { key: 's8', programme: pRiiId, name: 'Innovation and Enterprise Development', head: 'Mr. Mutyasira — Pro-Vice Chancellor, Research, Innovation and Enterprise Development', unitLabel: 'Unit' },
  ];
  const subIds = {};
  for (const s of SUBS_SEED) {
    // No sub-programme representative was explicitly identified in the supplied roster.
    // Keep this nullable rather than inventing a person or login account.
    const { lastInsertRowid: id } = await insertSub.run(s.programme, s.name, s.head, s.unitLabel, null);
    subIds[s.key] = id;
  }

  // Units/departments/faculties are populated from the organisational list supplied.
  // A named leader is attached only where the designation clearly matches the unit.
  const UNITS_SEED = [
    { key: 'u1', sub: 's1', name: 'Academic Registry', head: 'Mr. A. Dzobo', title: 'Deputy Registrar, Academic Registry', kind: 'Department' },
    { key: 'u2', sub: 's1', name: 'Human Resources', head: 'Mrs. Y.P. Museruka', title: 'Deputy Registrar, Human Resources', kind: 'Department' },
    { key: 'u3', sub: 's2', name: 'Finance and Administration', head: 'Ms. M. Makaza', title: 'Deputy Bursar, Finance & Administration', kind: 'Department' },
    { key: 'u4', sub: 's2', name: 'Cost Management, Budgetary Control and Student Accounts', head: 'Mr. L. Tom', title: 'Deputy Bursar, Costing, Budgetary Control & Student Accounts', kind: 'Department' },
    { key: 'u5', sub: 's4', name: 'Infrastructure and Networks', head: 'Mr. C. Nsingo', title: 'Manager, Infrastructure and Networks', kind: 'Unit' },
    { key: 'u6', sub: 's4', name: 'Information Systems and ICT', head: 'Eng. M. Mvenge', title: 'Director, ICT', kind: 'Unit' },
    { key: 'u7', sub: 's3', name: 'Legal Services, Partnerships and Internationalisation', head: 'Dr. T. Kasuso', title: 'Manager, Legal Services, Partnerships and Internationalisation Affairs', kind: 'Unit' },
    { key: 'u8', sub: 's3', name: 'Quality Assurance', head: 'Ms. J. Mudzamiri', title: 'Acting Manager, Quality Assurance', kind: 'Unit' },
    { key: 'u9', sub: 's5', name: 'Faculty of Arts, Culture and Heritage Studies', head: 'Professor S. Nyota', title: 'Dean, Faculty of Arts, Culture and Heritage Studies', kind: 'Faculty' },
    { key: 'u10', sub: 's5', name: 'Faculty of Education', head: 'Professor T. Tshabalala', title: 'Dean, Faculty of Education', kind: 'Faculty' },
    { key: 'u11', sub: 's6', name: 'Library Services', head: 'Mr. Madziwo', title: 'Librarian', kind: 'Unit' },
    { key: 'u12', sub: 's6', name: 'Records Management', head: 'Mr. N. Vhumbunu', title: 'Manager, Records Management Unit', kind: 'Unit' },
    { key: 'u13', sub: 's7', name: 'Postgraduate Studies', head: 'Dr. G. Masengwe', title: 'Research Fellow', kind: 'Unit' },
    { key: 'u14', sub: 's7', name: 'Research and Research Support', head: 'Professor T. Mapolisa', title: 'Director, Research, Innovation & Technological Transfer', kind: 'Unit' },
    { key: 'u15', sub: 's8', name: 'Innovation and Intellectual Property', head: 'Mr. T. Makandwa', title: 'Manager, Intellectual Property', kind: 'Unit' },
    { key: 'u16', sub: 's8', name: 'Enterprise Development', head: 'Mr. B. Mutyoraringa', title: 'Manager, Enterprise Development', kind: 'Unit' },
    { key: 'u17', sub: 's5', name: 'Faculty of Law', head: 'Dr. I. Nzero', title: 'Dean, Faculty of Law', kind: 'Faculty' },
    { key: 'u18', sub: 's5', name: 'Faculty of Applied Social Sciences', head: 'Dr. G. Tsvuura', title: 'Dean, Faculty of Applied Social Sciences', kind: 'Faculty' },
    { key: 'u19', sub: 's5', name: 'Faculty of Science', head: 'Dr. K. Dzinavatonga', title: 'Dean, Faculty of Science', kind: 'Faculty' },
    { key: 'u20', sub: 's5', name: 'Faculty of Technology', head: 'Mr. H. Marufu', title: 'Acting Dean, Faculty of Technology', kind: 'Faculty' },
    { key: 'u21', sub: 's5', name: 'Faculty of Commerce', head: 'Dr. B. Mbuyisa', title: 'Dean, Faculty of Commerce', kind: 'Faculty' },
    { key: 'u22', sub: 's3', name: 'Corporate Communications and Marketing', head: 'Mrs. S. Moyo', title: 'Director, Corporate Communications & Marketing', kind: 'Unit' },
    { key: 'u23', sub: 's3', name: 'Works and Estates', head: 'Mr. C. Jaricha', title: 'Acting Director, Works & Estates', kind: 'Unit' },
    { key: 'u24', sub: 's3', name: 'Community Engagement and Outreach', head: 'Dr. T. Rugoho', title: 'Manager, Community Engagement & Outreach', kind: 'Unit' },
    { key: 'u25', sub: 's3', name: 'Procurement', head: 'Dr. S. Ndebele', title: 'Manager, Procurement', kind: 'Unit' },
    { key: 'u26', sub: 's3', name: 'Risk Management', head: 'Ms. B. Mugandani', title: 'Acting Manager, Risk Management', kind: 'Unit' },
    { key: 'u27', sub: 's3', name: 'Internal Audit', head: 'Mr. M. Mangoma', title: 'Senior Internal Auditor', kind: 'Unit' },
    { key: 'u28', sub: 's3', name: 'Admissions', head: 'Mr. E. Maendaenda', title: 'Manager, Admissions', kind: 'Unit' },
    { key: 'u29', sub: 's3', name: 'Examinations', head: 'Ms. J. Mutumha', title: 'Manager, Examinations', kind: 'Unit' },
    { key: 'u30', sub: 's3', name: 'Staff Development and Industrial Relations', head: 'Mr. M. Chirima', title: 'Manager, Staff Development and Industrial Relations', kind: 'Unit' },
    { key: 'u31', sub: 's3', name: 'Human Resources Management', head: 'Ms. M. Masveure', title: 'Manager, Human Resources Management', kind: 'Unit' },
    { key: 'u32', sub: 's3', name: 'Security Services', head: 'Dr. M. Dzichauya', title: 'Chief Security Officer', kind: 'Unit' },
    { key: 'u33', sub: 's3', name: 'Transport and Logistics', head: 'Mr. N. Garira', title: 'Acting Manager, Transport and Logistics', kind: 'Unit' },
    { key: 'u34', sub: 's8', name: 'Business Development', head: 'Dr. T. Chikuvire', title: 'Manager, Business Development', kind: 'Unit' },
    { key: 'u35', sub: 's8', name: 'Printing Press', head: 'Mr. N. Shati', title: 'Manager, Printing Press', kind: 'Unit' },
    { key: 'u36', sub: 's5', name: 'Student Affairs', head: 'Mr. E. Mberi', title: 'Manager, Student Affairs', kind: 'Unit' },
    { key: 'u37', sub: 's3', name: 'Campus Radio', head: 'Mr. C. Mabaso', title: 'Director, Campus Radio', kind: 'Unit' },
    { key: 'u38', sub: 's5', name: 'Teaching and Learning', head: 'Professor C. Chiome', title: 'Director, Teaching and Learning', kind: 'Unit' },
    { key: 'u39', sub: 's3', name: 'Vice Chancellor Office', head: 'Dr. M. Chiwodza', title: "Executive Director, Vice Chancellor's Office", kind: 'Unit' },
    { key: 'u40', sub: 's5', name: 'Graduate School of Business', head: 'Professor L. Dube', title: 'Director, Graduate School of Business', kind: 'Unit' },
    { key: 'u41', sub: 's1', name: 'Corporate Planning and Administration', head: null, title: null, kind: 'Department' },
    { key: 'u42', sub: 's1', name: 'Alumni Relations', head: null, title: null, kind: 'Unit' },
    { key: 'u43', sub: 's5', name: 'Regional Campuses', head: null, title: null, kind: 'Unit' },
    { key: 'u44', sub: 's5', name: 'Materials Development', head: null, title: null, kind: 'Unit' },
  ];

  const unitIds = {};
  const assignedNames = new Set();
  for (const u of UNITS_SEED) {
    const headUserId = u.head ? await makeUser(u.head, u.title, 'unithead', 'unit', null) : null;
    const { lastInsertRowid: id } = await insertUnit.run(subIds[u.sub], u.name, u.head, u.kind || 'Unit', headUserId);
    if (headUserId) await db.prepare('UPDATE users SET scope_id = ? WHERE id = ?').run(id, headUserId);
    unitIds[u.key] = id;
    if (u.head) assignedNames.add(u.head);
  }

  // Additional officers from the supplied roster are attached to the closest
  // explicitly named functional unit; similar surnames remain separate people.
  const STAFF_SEED = [
    { unit: 'u1', name: 'Mr. D. Mrewa', role: 'Deputy Registrar, Administration' },
    { unit: 'u8', name: 'Mr. B. Gabi', role: 'Director, Quality Assurance' },
    { unit: 'u3', name: 'Mr. L. Tom', role: 'Deputy Bursar, Costing, Budgetary Control & Student Accounts' },
    { unit: 'u11', name: 'Mr. E. Madziwo', role: 'Deputy Librarian' },
    { unit: 'u5', name: 'Mr. A. Muramba', role: 'Manager, Information Systems' },
    { unit: 'u14', name: 'Dr. G. Masengwe', role: 'Research Fellow' },
    { unit: 'u24', name: 'Professor E. S. Gudhlanga', role: 'Acting Director, Community Engagement & Outreach' },
    { unit: 'u16', name: 'Mr. B. Mutyoraringa', role: 'Manager, Enterprise Development' },
    { unit: 'u15', name: 'Mr. T. Makandwa', role: 'Manager, Intellectual Property' },
    { unit: 'u34', name: 'Dr. T. Chikuvire', role: 'Manager, Business Development' },
    { unit: 'u35', name: 'Mr. N. Shati', role: 'Manager, Printing Press' },
    { unit: 'u37', name: 'Mr. C. Mabaso', role: 'Director, Campus Radio' },
  ];
  const employeeIds = {};
  let employeeCounter = 1;
  for (const person of STAFF_SEED) {
    if (assignedNames.has(person.name)) continue;
    const userId = await makeUser(person.name, person.role, 'employee', 'employee', null);
    const { lastInsertRowid: id } = await insertEmployee.run(unitIds[person.unit], person.name, person.role, userId);
    await db.prepare('UPDATE users SET scope_id = ? WHERE id = ?').run(id, userId);
    employeeIds[`i${employeeCounter++}`] = id;
  }

  // Council approval account retained as a distinct role, but the roster supplied
  // does not identify the Council Chairperson by name; therefore no fictional
  // Council user is created in this seed.
  const ictId = await db.prepare('SELECT id FROM users WHERE name = ?').get('Eng. M. Mvenge');

  console.log('Seeding KPIs...');
  const insertKpi = db.prepare(
    'INSERT INTO kpis (owner_type, owner_id, name, type, measure, baseline, target, is_automated, lifecycle_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, \'active\')'
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
    ['unit', 'u1', 'Council meetings held', 'Output', 'meetings', 0, 3],
    ['unit', 'u1', 'Performance contracts signed', 'Output', 'contracts', 0, 7],
    ['unit', 'u1', 'Performance contract evaluations', 'Output', 'evaluations', 0, 20],
    ['sub', 's5', 'New programmes developed', 'Output', 'programmes', 0, 15],
    ['sub', 's5', 'Faculty radio educational programmes', 'Output', 'programmes', 0, 16],
    ['sub', 's7', 'Postgraduate students graduated', 'Output', 'students', 0, 100],
    ['sub', 's7', 'Publications produced', 'Output', 'publications', 0, 200],
    ['unit', 'u11', 'E-theses archived', 'Output', 'theses', 0, 2000],
    ['unit', 'u11', 'LIS systems integrated', 'Output', 'systems', 0, 4],
    ['unit', 'u3', 'Annual budget produced', 'Output', 'budgets', 0, 10],
    ['employee', 'i1', 'Students Mentored to Completion', 'Output', 'students', 15, 25],
    ['employee', 'i2', 'Student Records Processed', 'Output', 'records', 200, 350],
    ['employee', 'i3', 'Postgraduate Theses Reviewed', 'Output', 'theses', 4, 10],
    ['employee', 'i4', 'Support Tickets Closed within SLA (personal)', 'Output', '%', 75, 95],
  ];
  const idMaps = { sub: subIds, unit: unitIds, employee: employeeIds };
  const kpiIds = [];
  for (const [ownerType, ownerKey, name, type, measure, baseline, target, isAutomated] of KPIS_SEED) {
    const ownerId = idMaps[ownerType][ownerKey];
    const { lastInsertRowid: id } = await insertKpi.run(ownerType, ownerId, name, type, measure, baseline, target, isAutomated ? 1 : 0);
    kpiIds.push(id);
  }
  const unitIdsByName = new Map(UNITS_SEED.map((unit) => [unit.name, unitIds[unit.key]]));
  for (const kpi of DASHBOARD_OUTPUT_KPIS) {
    const ownerId = unitIdsByName.get(kpi.ownerName);
    if (!ownerId) throw new Error(`No seeded unit found for dashboard KPI "${kpi.name}": ${kpi.ownerName}`);
    const { lastInsertRowid: id } = await insertKpi.run(
      'unit', ownerId, kpi.name, kpi.type, kpi.measure, kpi.baseline, kpi.target, 0
    );
    kpiIds.push(id);
  }

  console.log('Seeding a starter monthly value (current month, draft, empty) per KPI...');
  const insertValue = db.prepare(
    'INSERT INTO kpi_values (kpi_id, year, month, value, status) VALUES (?, ?, ?, NULL, \'draft\')'
  );
  const now = new Date();
  for (const id of kpiIds) await insertValue.run(id, now.getFullYear(), now.getMonth() + 1);

  console.log('Seeding audit log entries for setup...');
  const insertAudit = db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)');
  await insertAudit.run(ictId?.id || null, 'seed', 'system', null, 'Database seeded with ZOU leadership, organisational structure, accounts, and starter KPIs.');

  console.log('Done. Demo login: any seeded email + password "' + DEMO_PASSWORD + '".');
  console.log('Email format: surname + first initial (e.g. zuzet@zou.ac.zw). Review the generated user accounts before distributing credentials.');
});

(async () => {
  try {
    if (RESET_SEED && process.env.NODE_ENV === 'production') {
      throw new Error('Destructive seed reset is disabled in production.');
    }
    if (!RESET_SEED && !process.env.SEED_PASSWORD) {
      throw new Error('Set SEED_PASSWORD to a strong one-time password before running initial setup.');
    }
    await db.ready();
    await txn();
  } catch (err) {
    console.error('Seeding failed:', err);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
})();
