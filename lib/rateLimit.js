/**
 * MongoDB-backed fixed-window rate limiter (works across serverless instances).
 */
import RateLimit from "../models/RateLimit";

/**
 * Read the current counter without incrementing.
 * @returns {{ count: number, retryAfterSec: number }}
 */
export async function peekLimit(key, windowMs) {
  const doc = await RateLimit.findOne({ key }).lean();
  const now = Date.now();
  if (!doc || now - new Date(doc.windowStart).getTime() >= windowMs) {
    return { count: 0, retryAfterSec: 0 };
  }
  const retryAfterSec = Math.ceil((new Date(doc.windowStart).getTime() + windowMs - now) / 1000);
  return { count: doc.count, retryAfterSec };
}

/**
 * Atomically increment a counter. Starts a new window when the old one elapsed.
 * @returns {{ count: number, retryAfterSec: number }}
 */
export async function hitLimit(key, windowMs) {
  const now = new Date();
  const windowFloor = new Date(now.getTime() - windowMs);
  const expiresAt = new Date(now.getTime() + windowMs);

  // Reset an elapsed window (atomic, only one writer wins)
  await RateLimit.updateOne(
    { key, windowStart: { $lte: windowFloor } },
    { $set: { count: 0, windowStart: now, expiresAt } },
  );

  let doc;
  try {
    doc = await RateLimit.findOneAndUpdate(
      { key },
      { $inc: { count: 1 }, $setOnInsert: { windowStart: now, expiresAt } },
      { upsert: true, new: true },
    ).lean();
  } catch (err) {
    if (err?.code !== 11000) throw err;
    // Concurrent upsert race — retry once as a plain update
    doc = await RateLimit.findOneAndUpdate({ key }, { $inc: { count: 1 } }, { new: true }).lean();
  }
  const retryAfterSec = Math.ceil(
    (new Date(doc.windowStart).getTime() + windowMs - now.getTime()) / 1000,
  );
  return { count: doc.count, retryAfterSec: Math.max(retryAfterSec, 1) };
}

export async function resetLimit(key) {
  await RateLimit.deleteOne({ key });
}

/** Increment and report whether the caller is over `max` for this window. */
export async function consumeLimit(key, max, windowMs) {
  const r = await hitLimit(key, windowMs);
  return { allowed: r.count <= max, ...r };
}
