/**
 * A documented E2E test case. Each step's `action` is the exact name used for
 * Playwright's test.step (and so for the Allure step), and `expected` becomes the
 * nested "Verify: …" step. The same data generates e2e-test-scenarios.md.
 */
export type Priority = "P1 - Critical" | "P2 - High" | "P3 - Medium";

export interface StepDef {
  key: string;
  action: string;
  expected: string;
}

export interface Scenario {
  id: string;
  title: string;
  priority: Priority;
  component: string;
  preconditions: string;
  steps: StepDef[];
  /** Full Playwright test title: "<id> <title>". */
  readonly testTitle: string;
  step(key: string): StepDef;
}

export type StepTuple = [key: string, action: string, expected: string];

export function defineScenario(s: {
  id: string;
  title: string;
  priority: Priority;
  component: string;
  preconditions: string;
  steps: StepTuple[];
}): Scenario {
  const steps = s.steps.map(([key, action, expected]) => ({ key, action, expected }));
  const keys = new Set<string>();
  for (const st of steps) {
    if (keys.has(st.key)) throw new Error(`${s.id}: duplicate step key "${st.key}"`);
    keys.add(st.key);
  }
  return {
    ...s,
    steps,
    testTitle: `${s.id} ${s.title}`,
    step(key: string) {
      const found = steps.find((st) => st.key === key);
      if (!found) throw new Error(`${s.id}: no documented step "${key}". Add it to scenarios.ts first.`);
      return found;
    },
  };
}
