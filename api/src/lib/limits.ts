/** Application-level request/payload limits (DoS protection). */

/** Max total JSON request body size (bytes). */
export const MAX_BODY_BYTES = 1024 * 1024 // 1 MB

/** Max number of questions per survey in a single write. */
export const MAX_QUESTIONS_PER_SURVEY = 50

/** Max character length of a single submitted answer value. */
export const MAX_ANSWER_LENGTH = 10_000
