/**
 * State shared by the serial tests in one run (one worker): the quiz created in
 * E2E-02, each participant's credentials from their email (E2E-04..06), and the
 * option order each participant saw, so the admin view can be checked against it.
 */
export interface Credentials {
  link: string;
  password: string;
}

export const run = {
  quizPath: "",
  credentials: new Map<string, Credentials>(),
  /** participant id → per question, the option texts in the order shown. */
  optionOrder: new Map<string, string[][]>(),
};
