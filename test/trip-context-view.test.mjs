import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTripForm } from '../public/trip-context.mjs';

function createFormFixture(t) {
  const events = [];
  const settingsView = { hidden: true };
  function field(id, value = '') {
    return {
      id,
      value,
      parentNode: settingsView,
      willValidate: true,
      nativeValid: true,
      validationMessage: '',
      get validity() { return { valid: this.nativeValid && this.validationMessage === '' }; },
      setCustomValidity(message) { this.validationMessage = message; },
    };
  }
  const dayCount = field('tripDayCount', '2');
  const start = field('tripDailyStart', '09:00');
  const end = field('tripDailyEnd', '18:00');
  const options = { open: false };
  const form = {
    // The associated controls are on settings, outside the route form subtree.
    elements: [{ id: 'submit', willValidate: false, validity: { valid: false } }, dayCount, start, end],
    checkValidity() {
      events.push('check');
      return this.elements.every(control => !control.willValidate || control.validity.valid);
    },
    reportValidity() {
      events.push('report');
      return this.elements.every(control => !control.willValidate || control.validity.valid);
    },
  };
  for (const control of [dayCount, start, end]) control.form = form;
  const elements = { routeForm: form, tripOptions: options, tripDayCount: dayCount, tripDailyStart: start, tripDailyEnd: end };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { getElementById: id => elements[id] } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else delete globalThis.document;
  });
  const reveal = control => {
    assert.equal(control.parentNode, settingsView);
    assert.equal(control.form, form);
    assert.equal(options.open, true, 'open the condition details before revealing their field');
    settingsView.hidden = false;
    events.push(`reveal:${control.id}`);
  };
  return { dayCount, start, end, options, events, settingsView, reveal };
}

test('invalid associated trip fields reveal before native validation and equal-time errors clear on correction', t => {
  const fixture = createFormFixture(t);
  const { dayCount, start, end, options, events, settingsView, reveal } = fixture;
  dayCount.value = '15';
  dayCount.nativeValid = false;
  assert.equal(validateTripForm(reveal), false);
  assert.deepEqual(events, ['check', 'reveal:tripDayCount', 'report']);
  assert.equal(settingsView.hidden, false);

  dayCount.value = '2';
  dayCount.nativeValid = true;
  end.value = start.value;
  settingsView.hidden = true;
  options.open = false;
  events.length = 0;
  assert.equal(validateTripForm(reveal), false);
  assert.match(end.validationMessage, /开始和结束不可相同/);
  assert.deepEqual(events, ['check', 'reveal:tripDailyEnd', 'report']);

  // A daily window ending on the following day is a supported correction.
  end.value = '08:00';
  options.open = false;
  events.length = 0;
  assert.equal(validateTripForm(reveal), true);
  assert.equal(end.validationMessage, '');
  assert.equal(end.validity.valid, true);
  assert.equal(options.open, false);
  assert.deepEqual(events, ['check', 'report']);
});

test('valid trip input reports normally without opening or revealing the settings view', t => {
  const { end, options, events, settingsView } = createFormFixture(t);
  assert.equal(validateTripForm(() => assert.fail('valid input must not navigate away from the conversation')), true);
  assert.equal(end.validationMessage, '');
  assert.equal(options.open, false);
  assert.equal(settingsView.hidden, true);
  assert.deepEqual(events, ['check', 'report']);
});
