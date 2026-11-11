/**
 * RateLimit — fixed-window counters stored in MongoDB so limits hold across
 * serverless instances. Documents expire automatically via TTL.
 */
import mongoose from "mongoose";

const RateLimitSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  count: { type: Number, default: 0 },
  windowStart: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
});

RateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const RateLimit = mongoose.models.RateLimit || mongoose.model("RateLimit", RateLimitSchema);

export default RateLimit;
