import { expect, test } from "bun:test";
import { EventBus, type SpecEvent } from "../src/events.ts";

const ev: SpecEvent = { type: "presence", party: "machine-2", online: true, at: "2026-10-25T00:00:00Z" };

test("every listener hears an event; unsubscribe stops it", () => {
  const bus = new EventBus();
  const heard: string[] = [];
  const off = bus.subscribe((e) => heard.push(`a:${e.type}`));
  bus.subscribe((e) => heard.push(`b:${e.type}`));
  bus.publish(ev);
  off();
  bus.publish(ev);
  expect(heard).toEqual(["a:presence", "b:presence", "b:presence"]);
});

test("a listener that throws does not stop the others", () => {
  const bus = new EventBus();
  let reached = false;
  bus.subscribe(() => {
    throw new Error("boom");
  });
  bus.subscribe(() => (reached = true));
  bus.publish(ev);
  expect(reached).toBe(true);
});
