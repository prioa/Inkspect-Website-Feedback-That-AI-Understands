/**
 * The system's "reduce motion" setting. The CSS side switches its own
 * animations off via `@media (prefers-reduced-motion: reduce)` — this is the
 * counterpart for the JS side: anyone pairing an animation with a timer
 * (wait for it to finish, then tear down) has to drop the wait as well.
 * Otherwise an element that should long be gone just sits there visible,
 * only without the movement.
 */
export const motionOk = () => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
