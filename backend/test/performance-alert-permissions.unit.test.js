const { test } = require('node:test');
const assert = require('node:assert/strict');
const { correctiveActionPermissionError } = require('../src/utils/performanceAlertPermissions');

const action = { created_by: 10, responsible_user_id: 20 };

test('an approve-only reviewer can approve but cannot review their own action plan', () => {
  const reviewer = { id: 30, permissions: ['approve_corrective_actions'] };
  assert.equal(correctiveActionPermissionError(action, 'approved', reviewer), null);
  assert.match(
    correctiveActionPermissionError(action, 'approved', { ...reviewer, id: action.created_by }),
    /someone other than its creator/,
  );
  assert.match(
    correctiveActionPermissionError(action, 'approved', { id: 30, permissions: [] }),
    /do not have permission/,
  );
});

test('managers submit or revise plans while responsible users advance their assigned actions', () => {
  const manager = { id: 30, permissions: ['manage_corrective_actions'] };
  const responsible = { id: action.responsible_user_id, permissions: ['data_entry'] };

  assert.equal(correctiveActionPermissionError(action, 'submitted', manager), null);
  assert.equal(correctiveActionPermissionError(action, 'draft', manager), null);
  assert.equal(correctiveActionPermissionError(action, 'in_progress', responsible), null);
  assert.equal(correctiveActionPermissionError(action, 'completed', responsible), null);
  assert.match(
    correctiveActionPermissionError(action, 'completed', { id: 30, permissions: ['data_entry'] }),
    /corrective action owner/,
  );
});
