const { test, describe, after, before } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("Life Management: Offline Calendar & Focus Sessions", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-life-test-"));
  process.env.FRIENDS_DATA_DIR = tempDir;
  process.env.LOG_LEVEL = "error";

  const life = require("../server/life");

  after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("Calendar: add, list and delete calendar events", async () => {
    const ev1 = await life.addCalendarEvent({
      title: "Team Standup",
      start: "2026-10-06T10:00:00",
      end: "2026-10-06T10:30:00",
      location: "Room A",
      description: "Daily sync",
    });
    assert.ok(ev1.id);
    assert.strictEqual(ev1.title, "Team Standup");

    const ev2 = await life.addCalendarEvent({
      title: "Client Pitch",
      start: "2026-10-06T14:00:00",
      end: "2026-10-06T15:00:00",
      location: "Online",
    });
    assert.ok(ev2.id);

    const list = await life.listCalendarEvents();
    assert.strictEqual(list.length, 2);

    const filtered = await life.listCalendarEvents({
      start: "2026-10-06T09:00:00",
      end: "2026-10-06T12:00:00",
    });
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].title, "Team Standup");

    const delRes = await life.deleteCalendarEvent(ev1.id);
    assert.strictEqual(delRes.ok, true);

    const remaining = await life.listCalendarEvents();
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0].title, "Client Pitch");
  });

  test("Calendar: export and import .ics files", async () => {
    const icsContent = await life.exportCalendarIcs();
    assert.match(icsContent, /BEGIN:VCALENDAR/);
    assert.match(icsContent, /SUMMARY:Client Pitch/);
    assert.match(icsContent, /END:VCALENDAR/);

    const sampleIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//EN",
      "BEGIN:VEVENT",
      "UID:sample-test-12345",
      "SUMMARY:Dentist Appointment",
      "DTSTART:20261015T100000Z",
      "DTEND:20261015T110000Z",
      "LOCATION:Dental Clinic",
      "DESCRIPTION:Checkup and cleaning",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const importRes = await life.importCalendarIcs(sampleIcs);
    assert.strictEqual(importRes.ok, true);
    assert.strictEqual(importRes.imported, 1);

    const allEvents = await life.listCalendarEvents();
    const dentist = allEvents.find((e) => e.title === "Dentist Appointment");
    assert.ok(dentist);
    assert.strictEqual(dentist.location, "Dental Clinic");
  });

  test("Focus sessions: start, check status, and stop", async () => {
    const focus = await life.startFocus("Deep Work on Voice Mode", 25);
    assert.strictEqual(focus.active, true);
    assert.strictEqual(focus.task, "Deep Work on Voice Mode");
    assert.strictEqual(focus.minutes, 25);
    assert.ok(focus.remainingSeconds > 0);

    const current = await life.checkFocus();
    assert.strictEqual(current.active, true);
    assert.strictEqual(current.task, "Deep Work on Voice Mode");

    const stopped = await life.stopFocus();
    assert.strictEqual(stopped.ok, true);

    const afterStop = await life.checkFocus();
    assert.strictEqual(afterStop.active, false);
  });
});
